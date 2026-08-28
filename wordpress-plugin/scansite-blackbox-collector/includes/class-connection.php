<?php
/**
 * Connection state: pairing with ScanSite, credential storage, transport.
 *
 * Credentials live in wp_options:
 *   scansite_blackbox_site_id
 *   scansite_blackbox_collector_key
 *   scansite_blackbox_endpoint
 *
 * The collector key is never printed back into the admin UI once saved — only
 * a masked placeholder is shown.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class ScanSite_BB_Connection {

	const OPT_SITE_ID   = 'scansite_blackbox_site_id';
	const OPT_KEY       = 'scansite_blackbox_collector_key';
	const OPT_ENDPOINT  = 'scansite_blackbox_endpoint';
	const OPT_STATE     = 'scansite_blackbox_state';
	const OPT_LAST_ERROR = 'scansite_blackbox_last_error';

	/** Connection states surfaced in the admin screen. */
	const STATE_DISCONNECTED = 'disconnected';
	const STATE_CONNECTING   = 'connecting';
	const STATE_CONNECTED    = 'connected';
	const STATE_ERROR        = 'error';

	public static function site_id() {
		return get_option( self::OPT_SITE_ID, '' );
	}

	public static function collector_key() {
		return get_option( self::OPT_KEY, '' );
	}

	public static function endpoint() {
		return untrailingslashit( (string) get_option( self::OPT_ENDPOINT, '' ) );
	}

	public static function state() {
		return get_option( self::OPT_STATE, self::STATE_DISCONNECTED );
	}

	public static function last_error() {
		return get_option( self::OPT_LAST_ERROR, '' );
	}

	public static function is_connected() {
		return self::STATE_CONNECTED === self::state() && self::has_credentials();
	}

	/**
	 * Whether this site has the credentials needed to talk to ScanSite.
	 *
	 * Delivery paths must gate on this rather than on is_connected(). The state
	 * is a report of the last attempt, so gating on it means one failed delivery
	 * switches the state to "error" and the collector then refuses to retry —
	 * the queue would never drain after a ScanSite outage, even once ScanSite
	 * came back.
	 *
	 * @return bool
	 */
	public static function has_credentials() {
		return (bool) self::site_id()
			&& (bool) self::collector_key()
			&& (bool) self::endpoint();
	}

	public static function set_state( $state, $error = '' ) {
		update_option( self::OPT_STATE, $state, false );
		update_option( self::OPT_LAST_ERROR, $error, false );
	}

	/**
	 * Pair with ScanSite using a short, single-use connection code.
	 *
	 * @param string $code
	 * @param string $endpoint ScanSite base URL, e.g. http://localhost:3000
	 * @return true|WP_Error
	 */
	public static function connect( $code, $endpoint ) {
		$code     = strtoupper( trim( (string) $code ) );
		$endpoint = untrailingslashit( trim( (string) $endpoint ) );

		if ( '' === $code ) {
			return new WP_Error( 'scansite_no_code', 'Enter the connection code from ScanSite.' );
		}
		if ( ! filter_var( $endpoint, FILTER_VALIDATE_URL ) ) {
			return new WP_Error( 'scansite_bad_endpoint', 'Enter a valid ScanSite URL.' );
		}

		self::set_state( self::STATE_CONNECTING );

		$payload = wp_json_encode(
			array(
				'code'      => $code,
				'siteUrl'   => home_url(),
				'wordpress' => self::environment(),
			)
		);

		$response = self::request( $endpoint . '/api/blackbox/connect', $payload, array(), 20 );

		if ( is_wp_error( $response ) ) {
			self::set_state( self::STATE_ERROR, self::friendly_error( $response ) );
			return $response;
		}

		$body = json_decode( wp_remote_retrieve_body( $response ), true );
		$code_status = (int) wp_remote_retrieve_response_code( $response );

		if ( 200 !== $code_status || empty( $body['success'] ) ) {
			$message = isset( $body['error'] ) ? $body['error'] : 'ScanSite rejected the connection code.';
			self::set_state( self::STATE_ERROR, $message );
			return new WP_Error( 'scansite_connect_failed', $message );
		}

		update_option( self::OPT_SITE_ID, sanitize_text_field( $body['siteId'] ) );
		update_option( self::OPT_KEY, $body['collectorKey'] );
		update_option( self::OPT_ENDPOINT, $endpoint );
		self::set_state( self::STATE_CONNECTED );

		return true;
	}

	/** Remove stored credentials. */
	public static function disconnect() {
		delete_option( self::OPT_SITE_ID );
		delete_option( self::OPT_KEY );
		delete_option( self::OPT_ENDPOINT );
		self::set_state( self::STATE_DISCONNECTED );
	}

	/**
	 * Environment facts only — never configuration values or secrets.
	 *
	 * @return array
	 */
	public static function environment() {
		global $wp_version;

		$theme = wp_get_theme();

		return array(
			'version'       => isset( $wp_version ) ? $wp_version : get_bloginfo( 'version' ),
			'phpVersion'    => PHP_VERSION,
			'pluginVersion' => SCANSITE_BB_VERSION,
			'siteUrl'       => site_url(),
			'homeUrl'       => home_url(),
			'multisite'     => is_multisite(),
			'theme'         => array(
				'name'    => $theme->get( 'Name' ),
				'version' => $theme->get( 'Version' ),
			),
			'plugins'       => array(
				'active'   => count( (array) get_option( 'active_plugins', array() ) ),
				'inactive' => 0,
			),
		);
	}

	/**
	 * POST JSON to ScanSite with this site's credentials.
	 *
	 * @param string $url
	 * @param string $body
	 * @param array  $extra_headers
	 * @param int    $timeout
	 * @return array|WP_Error
	 */
	public static function request( $url, $body, $extra_headers = array(), $timeout = 10 ) {
		$headers = ScanSite_BB_Signing::headers( self::site_id(), self::collector_key(), $body );
		$headers = array_merge( $headers, $extra_headers );

		return wp_remote_post(
			$url,
			array(
				'headers'     => $headers,
				'body'        => $body,
				'timeout'     => $timeout,
				'redirection' => 0,
				'blocking'    => true,
				// Never let a ScanSite outage break the WordPress request that
				// triggered it.
				'sslverify'   => true,
			)
		);
	}

	/**
	 * Turn transport failures into something a normal user can act on.
	 * Stack traces are never surfaced.
	 *
	 * @param WP_Error $error
	 * @return string
	 */
	public static function friendly_error( $error ) {
		$message = $error->get_error_message();

		if ( false !== stripos( $message, 'cURL error 28' ) || false !== stripos( $message, 'timed out' ) ) {
			return 'Request timed out. Check that this website can reach your ScanSite URL.';
		}
		if ( false !== stripos( $message, 'cURL error 6' ) || false !== stripos( $message, 'resolve host' ) ) {
			return 'ScanSite endpoint unreachable. Check the ScanSite URL.';
		}
		if ( false !== stripos( $message, 'SSL' ) ) {
			return 'ScanSite endpoint could not be reached over HTTPS.';
		}

		return 'ScanSite could not be reached from this website.';
	}
}
