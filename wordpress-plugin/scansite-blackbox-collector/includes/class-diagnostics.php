<?php
/**
 * Collector diagnostics.
 *
 * Every check here is safe to run from wp-admin: nothing modifies the site and
 * nothing is deleted. Results are human-readable by design — PHP stack traces
 * are never shown in the normal UI.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class ScanSite_BB_Diagnostics {

	const OPT_LAST_DELIVERY = 'scansite_blackbox_last_delivery';
	const OPT_FAILURES      = 'scansite_blackbox_failed_deliveries';

	/** Facts shown in the status header. Never includes the collector key. */
	public static function status() {
		$env = ScanSite_BB_Connection::environment();

		return array(
			'state'            => ScanSite_BB_Connection::state(),
			'endpoint'         => ScanSite_BB_Connection::endpoint(),
			'siteId'           => ScanSite_BB_Connection::site_id(),
			'collectorVersion' => defined( 'SCANSITE_BB_VERSION' ) ? SCANSITE_BB_VERSION : null,
			'wordpressVersion' => isset( $env['version'] ) ? $env['version'] : null,
			'phpVersion'       => PHP_VERSION,
			'lastHeartbeat'    => (int) get_option( ScanSite_BB_Heartbeat::OPT_LAST, 0 ),
			'lastDelivery'     => (int) get_option( self::OPT_LAST_DELIVERY, 0 ),
			'queuedEvents'     => ScanSite_BB_Events::queue_size(),
			'failedDeliveries' => (int) get_option( self::OPT_FAILURES, 0 ),
			'signingMode'      => ScanSite_BB_Signing::signing_enabled() ? 'enabled' : 'off',
			'lastError'        => ScanSite_BB_Connection::last_error(),
		);
	}

	/** Record a successful delivery. */
	public static function record_delivery() {
		update_option( self::OPT_LAST_DELIVERY, time(), false );
		update_option( self::OPT_FAILURES, 0, false );
	}

	/** Record a failed delivery. */
	public static function record_failure() {
		update_option( self::OPT_FAILURES, (int) get_option( self::OPT_FAILURES, 0 ) + 1, false );
	}

	/**
	 * Run every check and return the results.
	 *
	 * @param array $args { 'network' => bool } — set network=false to skip
	 *        checks that call ScanSite, for a fast local-only run.
	 * @return array list of { id, label, status, message, detail }
	 */
	public static function run( $args = array() ) {
		$network = ! isset( $args['network'] ) || $args['network'];
		$checks  = array();

		$checks[] = self::check(
			'config',
			'Collector configuration',
			ScanSite_BB_Connection::endpoint() && ScanSite_BB_Connection::site_id(),
			'Collector is configured.',
			'The collector has not been connected yet. Enter the connection code from ScanSite.'
		);

		$checks[] = self::check(
			'endpoint',
			'ScanSite endpoint',
			(bool) filter_var( ScanSite_BB_Connection::endpoint(), FILTER_VALIDATE_URL ),
			'ScanSite endpoint is configured.',
			'No valid ScanSite endpoint is stored.'
		);

		$checks[] = self::check(
			'site_id',
			'Site ID',
			(bool) ScanSite_BB_Connection::site_id(),
			'Site ID present.',
			'No Site ID is stored. Reconnect from ScanSite.'
		);

		$checks[] = self::check(
			'key',
			'Collector key',
			(bool) ScanSite_BB_Connection::collector_key(),
			'Collector key is stored.',
			'No collector key is stored. Reconnect from ScanSite.'
		);

		// Outbound HTTP, independent of ScanSite so a ScanSite outage and a
		// blocked outbound request can be told apart.
		$outbound = wp_remote_head( 'https://api.wordpress.org/plugins/info/1.2/', array( 'timeout' => 8 ) );
		$outbound_ok = ! is_wp_error( $outbound );
		$checks[] = self::check(
			'outbound',
			'Outbound HTTP requests',
			$outbound_ok,
			'This website can make outbound HTTP requests.',
			is_wp_error( $outbound )
				? 'WordPress outbound HTTP requests appear to be disabled or blocked: ' . $outbound->get_error_message()
				: 'WordPress outbound HTTP requests appear to be disabled.'
		);

		if ( $network && ScanSite_BB_Connection::is_connected() ) {
			$endpoint = ScanSite_BB_Connection::endpoint();

			$ping = ScanSite_BB_Connection::request( $endpoint . '/api/blackbox/sites', '', array(), 10 );
			// A 401/405 proves the endpoint answered, which is all this checks.
			$reachable = ! is_wp_error( $ping );
			$checks[] = self::check(
				'reachable',
				'ScanSite endpoint reachable',
				$reachable,
				'ScanSite responded.',
				is_wp_error( $ping )
					? 'ScanSite endpoint could not be reached. ' . ScanSite_BB_Connection::friendly_error( $ping )
					: 'ScanSite endpoint could not be reached.'
			);

			$hb     = ScanSite_BB_Heartbeat::instance()->send();
			$hb_ok  = ScanSite_BB_Connection::STATE_CONNECTED === ScanSite_BB_Connection::state();
			$checks[] = self::check(
				'heartbeat',
				'Heartbeat',
				$hb_ok,
				'Heartbeat accepted by ScanSite.',
				'Heartbeat was rejected. ' . ScanSite_BB_Connection::last_error()
			);

			$auth_ok = $hb_ok;
			$checks[] = self::check(
				'auth',
				'Authentication',
				$auth_ok,
				'Collector credentials accepted.',
				'Collector credentials were rejected. Rotate or re-enter the connection code in ScanSite.'
			);

			$test = ScanSite_BB_Collector::run_connection_test();
			$checks[] = self::check(
				'ingest',
				'Event delivery',
				true === $test,
				'ScanSite accepted a test event.',
				is_wp_error( $test ) ? $test->get_error_message() : 'ScanSite did not accept the test event.'
			);
		}

		// WP-Cron.
		$cron_disabled = defined( 'DISABLE_WP_CRON' ) && DISABLE_WP_CRON;
		$checks[] = array(
			'id'      => 'cron',
			'label'   => 'WP-Cron',
			'status'  => $cron_disabled ? 'warn' : ( wp_next_scheduled( ScanSite_BB_Collector::FLUSH_HOOK ) ? 'pass' : 'warn' ),
			'message' => $cron_disabled
				? 'WP-Cron automatic triggering is disabled. A real system cron may still be running WordPress cron tasks.'
				: ( wp_next_scheduled( ScanSite_BB_Collector::FLUSH_HOOK )
					? 'Event delivery is scheduled.'
					: 'Event delivery task is not scheduled yet. It is registered on the next init.' ),
			'detail'  => array(
				'disableWpCron' => $cron_disabled,
				'flushNext'     => wp_next_scheduled( ScanSite_BB_Collector::FLUSH_HOOK ),
				'heartbeatNext' => wp_next_scheduled( ScanSite_BB_Heartbeat::HOOK ),
			),
		);

		$hooks_registered = has_action( ScanSite_BB_Collector::FLUSH_HOOK ) && has_action( ScanSite_BB_Heartbeat::HOOK );
		$checks[] = self::check(
			'cron_hooks',
			'Collector cron hooks',
			(bool) $hooks_registered,
			'Collector cron callbacks are registered.',
			'Collector cron callbacks are not registered for this request.'
		);

		// Queue read/write.
		$queue   = get_option( ScanSite_BB_Events::OPT_QUEUE, array() );
		$probe   = 'scansite_blackbox_queue_probe';
		$before  = get_option( $probe, null );
		$writable = update_option( $probe, time(), false );
		$readable = ( time() === (int) get_option( $probe, 0 ) );
		if ( null === $before ) {
			delete_option( $probe );
		} else {
			update_option( $probe, $before, false );
		}
		$checks[] = self::check(
			'queue',
			'Local queue',
			( $writable || $readable ) && is_array( $queue ),
			'Queue is readable and writable (' . ScanSite_BB_Events::queue_size() . ' pending).',
			'Event queue could not be updated. Check that wp_options is writable by WordPress.'
		);

		// Config hash checkpoints.
		$hashable = is_readable( ABSPATH . 'wp-config.php' ) && false !== hash_file( 'sha256', ABSPATH . 'wp-config.php' );
		$checks[] = self::check(
			'file_monitor',
			'File monitoring',
			$hashable,
			'Configuration file checkpoints can be created.',
			'Configuration files are not readable, so changes to them cannot be detected.'
		);

		return $checks;
	}

	/**
	 * @param string $id
	 * @param string $label
	 * @param bool   $ok
	 * @param string $pass_message
	 * @param string $fail_message
	 * @return array
	 */
	private static function check( $id, $label, $ok, $pass_message, $fail_message ) {
		return array(
			'id'      => $id,
			'label'   => $label,
			'status'  => $ok ? 'pass' : 'fail',
			'message' => $ok ? $pass_message : $fail_message,
		);
	}

	/**
	 * Safe queue metadata for the inspector. Only type, time and attempt count —
	 * never targets, actors or metadata, which could carry identifying detail.
	 *
	 * @param int $limit
	 * @return array
	 */
	public static function queue_preview( $limit = 20 ) {
		$queue = get_option( ScanSite_BB_Events::OPT_QUEUE, array() );
		if ( ! is_array( $queue ) ) {
			return array();
		}

		$out = array();
		foreach ( array_slice( $queue, 0, max( 1, (int) $limit ) ) as $event ) {
			if ( ! is_array( $event ) ) {
				continue;
			}
			$out[] = array(
				'type'      => isset( $event['type'] ) ? (string) $event['type'] : 'unknown',
				'category'  => isset( $event['category'] ) ? (string) $event['category'] : '',
				'timestamp' => isset( $event['timestamp'] ) ? (string) $event['timestamp'] : '',
			);
		}

		return $out;
	}
}
