<?php
/**
 * Heartbeat — tells ScanSite "I am alive" on a schedule.
 *
 * Runs from WP-Cron, never during a visitor request.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class ScanSite_BB_Heartbeat {

	const HOOK     = 'scansite_blackbox_heartbeat';
	const INTERVAL = 300; // 5 minutes
	const OPT_LAST = 'scansite_blackbox_last_heartbeat';

	/** @var ScanSite_BB_Heartbeat|null */
	private static $instance = null;

	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	public function boot() {
		add_action( self::HOOK, array( $this, 'send' ) );
		add_filter( 'cron_schedules', array( $this, 'register_interval' ) );

		// Deferred to init — see ScanSite_BB_Collector::boot().
		add_action( 'init', array( $this, 'maybe_schedule' ), 5 );
	}

	/** Register the recurring heartbeat if it is not already scheduled. */
	public function maybe_schedule() {
		if ( ! wp_next_scheduled( self::HOOK ) ) {
			wp_schedule_event( time() + 60, 'scansite_blackbox_five_minutes', self::HOOK );
		}
	}

	public function register_interval( $schedules ) {
		if ( ! isset( $schedules['scansite_blackbox_five_minutes'] ) ) {
			$schedules['scansite_blackbox_five_minutes'] = array(
				'interval' => self::INTERVAL,
				'display'  => did_action( 'init' )
					? __( 'Every 5 minutes (ScanSite)', 'scansite-blackbox' )
					: 'Every 5 minutes (ScanSite)',
			);
		}
		return $schedules;
	}

	/** Send one heartbeat. */
	public function send() {
		// Same reasoning as the delivery flush: a transient failure must not
		// permanently stop the heartbeat, or the connection can never recover.
		if ( ! ScanSite_BB_Connection::has_credentials() ) {
			return;
		}

		$env = ScanSite_BB_Connection::environment();

		$payload = wp_json_encode(
			array(
				'siteId'           => ScanSite_BB_Connection::site_id(),
				'timestamp'        => gmdate( 'c' ),
				'pluginVersion'    => SCANSITE_BB_VERSION,
				'wordpressVersion' => $env['version'],
				'phpVersion'       => $env['phpVersion'],
			)
		);

		$response = ScanSite_BB_Connection::request(
			ScanSite_BB_Connection::endpoint() . '/api/blackbox/heartbeat',
			$payload,
			array(),
			10
		);

		if ( is_wp_error( $response ) ) {
			ScanSite_BB_Connection::set_state(
				ScanSite_BB_Connection::STATE_ERROR,
				ScanSite_BB_Connection::friendly_error( $response )
			);
			return;
		}

		$status = (int) wp_remote_retrieve_response_code( $response );

		if ( 200 === $status ) {
			update_option( self::OPT_LAST, time(), false );
			if ( ScanSite_BB_Connection::STATE_CONNECTED !== ScanSite_BB_Connection::state() ) {
				ScanSite_BB_Connection::set_state( ScanSite_BB_Connection::STATE_CONNECTED );
			}
			return;
		}

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
		}
	}

	public static function unschedule() {
		$timestamp = wp_next_scheduled( self::HOOK );
		if ( $timestamp ) {
			wp_unschedule_event( $timestamp, self::HOOK );
		}
	}
}
