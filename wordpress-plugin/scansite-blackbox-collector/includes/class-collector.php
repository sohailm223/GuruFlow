<?php
/**
 * Delivery.
 *
 * Events are queued by ScanSite_BB_Events and flushed from WP-Cron in small
 * batches. No visitor request ever waits on ScanSite.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class ScanSite_BB_Collector {

	const FLUSH_HOOK    = 'scansite_blackbox_flush';
	const FLUSH_INTERVAL = 60; // seconds
	const MAX_ATTEMPTS  = 5;
	const OPT_ATTEMPTS  = 'scansite_blackbox_flush_attempts';

	/** @var ScanSite_BB_Collector|null */
	private static $instance = null;

	/** @var ScanSite_BB_Events */
	public $events;

	/** @var ScanSite_BB_File_Integrity */
	public $fim;

	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	public function boot() {
		$this->events = new ScanSite_BB_Events();
		$this->events->register_hooks();

		$this->fim = new ScanSite_BB_File_Integrity( $this->events );

		add_action( self::FLUSH_HOOK, array( $this, 'flush' ) );
		add_filter( 'cron_schedules', array( $this, 'register_interval' ) );

		// Scheduling is deferred to init on purpose. wp_schedule_event()
		// validates the recurrence through wp_get_schedules(), which
		// translates the schedule label — and translating before init raises
		// WordPress 6.7's just-in-time textdomain notice on every page load.
		add_action( 'init', array( $this, 'maybe_schedule' ), 5 );
	}

	/** Register the recurring delivery job if it is not already scheduled. */
	public function maybe_schedule() {
		if ( ! wp_next_scheduled( self::FLUSH_HOOK ) ) {
			wp_schedule_event( time() + 30, 'scansite_blackbox_minute', self::FLUSH_HOOK );
		}
	}

	public function register_interval( $schedules ) {
		if ( ! isset( $schedules['scansite_blackbox_minute'] ) ) {
			$schedules['scansite_blackbox_minute'] = array(
				'interval' => self::FLUSH_INTERVAL,
				// Only translate once WordPress is ready to load the textdomain.
				'display'  => did_action( 'init' )
					? __( 'Every minute (ScanSite)', 'scansite-blackbox' )
					: 'Every minute (ScanSite)',
			);
		}
		return $schedules;
	}

	/**
	 * Send one batch of queued events. Failed batches are put back at the
	 * front of the queue and retried on the next run, up to MAX_ATTEMPTS.
	 */
	public function flush() {
		// Gate on credentials, not on the last-known state, so delivery resumes
		// by itself once ScanSite is reachable again.
		if ( ! ScanSite_BB_Connection::has_credentials() ) {
			return;
		}

		// Daily, self-throttled users/code snapshots for the dashboard panels.
		$this->events->maybe_send_snapshots();

		// Bounded, resumable file-integrity batches (baseline + requested scans).
		if ( $this->fim ) {
			$this->fim->maybe_run();
		}

		$batch = ScanSite_BB_Events::take_batch();
		if ( empty( $batch ) ) {
			delete_option( self::OPT_ATTEMPTS );
			return;
		}

		$payload = wp_json_encode(
			array(
				'site'   => ScanSite_BB_Connection::site_id(),
				'events' => $batch,
			)
		);

		$response = ScanSite_BB_Connection::request(
			ScanSite_BB_Connection::endpoint() . '/api/blackbox/ingest',
			$payload,
			array(),
			15
		);

		if ( ! is_wp_error( $response ) && 200 === (int) wp_remote_retrieve_response_code( $response ) ) {
			delete_option( self::OPT_ATTEMPTS );
			ScanSite_BB_Connection::set_state( ScanSite_BB_Connection::STATE_CONNECTED );
			ScanSite_BB_Diagnostics::record_delivery();
			return;
		}

		ScanSite_BB_Diagnostics::record_failure();
		$this->requeue( $batch );
		$this->record_failure( $response );
	}

	/**
	 * Put undelivered events back at the front of the queue so ordering is
	 * preserved on retry.
	 *
	 * @param array $batch
	 */
	private function requeue( $batch ) {
		$attempts = (int) get_option( self::OPT_ATTEMPTS, 0 ) + 1;

		// Give up rather than retry a permanently rejected batch forever.
		if ( $attempts > self::MAX_ATTEMPTS ) {
			delete_option( self::OPT_ATTEMPTS );
			update_option(
				'scansite_blackbox_dropped_events',
				(int) get_option( 'scansite_blackbox_dropped_events', 0 ) + count( $batch ),
				false
			);
			return;
		}

		update_option( self::OPT_ATTEMPTS, $attempts, false );

		$queue = get_option( ScanSite_BB_Events::OPT_QUEUE, array() );
		if ( ! is_array( $queue ) ) {
			$queue = array();
		}

		$queue = array_merge( $batch, $queue );

		if ( count( $queue ) > ScanSite_BB_Events::MAX_QUEUE ) {
			$queue = array_slice( $queue, 0, ScanSite_BB_Events::MAX_QUEUE );
		}

		update_option( ScanSite_BB_Events::OPT_QUEUE, $queue, false );
	}

	/**
	 * @param array|WP_Error $response
	 */
	private function record_failure( $response ) {
		if ( is_wp_error( $response ) ) {
			ScanSite_BB_Connection::set_state(
				ScanSite_BB_Connection::STATE_ERROR,
				ScanSite_BB_Connection::friendly_error( $response )
			);
			return;
		}

		$status = (int) wp_remote_retrieve_response_code( $response );

		if ( 401 === $status ) {
			ScanSite_BB_Connection::set_state(
				ScanSite_BB_Connection::STATE_ERROR,
				'Invalid connection key. Reconnect this website from ScanSite.'
			);
			return;
		}

		if ( 403 === $status ) {
			ScanSite_BB_Connection::set_state(
				ScanSite_BB_Connection::STATE_ERROR,
				'This website was disconnected in ScanSite.'
			);
			return;
		}

		ScanSite_BB_Connection::set_state(
			ScanSite_BB_Connection::STATE_ERROR,
			'Events could not be delivered. They are queued and will be retried.'
		);
	}

	/**
	 * Send the collector self-test used by the ScanSite "Run Connection Test"
	 * button. This one is intentionally synchronous — a human is waiting.
	 *
	 * @return true|WP_Error
	 */
	public static function run_connection_test() {
		if ( ! ScanSite_BB_Connection::has_credentials() ) {
			return new WP_Error( 'scansite_not_connected', 'This website is not connected yet.' );
		}

		$env = ScanSite_BB_Connection::environment();

		$payload = wp_json_encode(
			array(
				'eventId'          => 'evt_test_' . substr( md5( microtime( true ) . wp_rand() ), 0, 12 ),
				'type'             => 'collector_test',
				'category'         => 'core',
				'timestamp'        => gmdate( 'c' ),
				'message'          => 'Collector connection test',
				'pluginVersion'    => SCANSITE_BB_VERSION,
				'wordpressVersion' => $env['version'],
			)
		);

		$response = ScanSite_BB_Connection::request(
			ScanSite_BB_Connection::endpoint() . '/api/blackbox/verify',
			$payload,
			array(),
			15
		);

		if ( is_wp_error( $response ) ) {
			return new WP_Error(
				'scansite_test_failed',
				ScanSite_BB_Connection::friendly_error( $response )
			);
		}

		$status = (int) wp_remote_retrieve_response_code( $response );
		$body   = json_decode( wp_remote_retrieve_body( $response ), true );

		if ( 200 !== $status || empty( $body['success'] ) ) {
			$message = isset( $body['error'] ) ? $body['error'] : 'ScanSite could not receive the test event.';
			return new WP_Error( 'scansite_test_failed', $message );
		}

		return true;
	}

	/**
	 * "Send Test Event" from the WordPress admin screen.
	 *
	 * Deliberately goes through the same queue and delivery path as a normal
	 * event, so a green result proves the pipeline a real event will use — not
	 * just that the endpoint answers.
	 *
	 * @return true|WP_Error
	 */
	public function send_test_event() {
		if ( ! ScanSite_BB_Connection::has_credentials() ) {
			return new WP_Error( 'scansite_not_connected', 'This website is not connected yet.' );
		}

		$this->events->enqueue(
			'collector_test',
			'core',
			array( 'message' => 'Manual test event from the WordPress admin screen' )
		);

		$this->flush();

		if ( 0 === ScanSite_BB_Events::queue_size() ) {
			return true;
		}

		return new WP_Error(
			'scansite_test_queued',
			'The test event is queued and will be retried automatically. ' . ScanSite_BB_Connection::last_error()
		);
	}

	public static function activate() {
		// Nothing to create — the collector uses wp_options only.
		if ( ! wp_next_scheduled( self::FLUSH_HOOK ) ) {
			wp_schedule_event( time() + 30, 'scansite_blackbox_minute', self::FLUSH_HOOK );
		}
	}

	public static function deactivate() {
		$timestamp = wp_next_scheduled( self::FLUSH_HOOK );
		if ( $timestamp ) {
			wp_unschedule_event( $timestamp, self::FLUSH_HOOK );
		}
		ScanSite_BB_Heartbeat::unschedule();
	}
}
