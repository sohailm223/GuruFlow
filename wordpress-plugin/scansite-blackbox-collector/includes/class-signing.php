<?php
/**
 * Request signing.
 *
 * Isolated on purpose so HMAC signing can be switched on without touching the
 * rest of the collector. The MVP authenticates with the per-site collector key
 * alone; when signing is enabled the two extra headers are simply added.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class ScanSite_BB_Signing {

	const HEADER_SITE      = 'X-ScanSite-Site';
	const HEADER_KEY       = 'X-ScanSite-Key';
	const HEADER_TIMESTAMP = 'X-ScanSite-Timestamp';
	const HEADER_SIGNATURE = 'X-ScanSite-Signature';

	/**
	 * Build the authentication headers for a request.
	 *
	 * @param string $site_id
	 * @param string $collector_key
	 * @param string $body Raw JSON body.
	 * @return array
	 */
	public static function headers( $site_id, $collector_key, $body ) {
		$headers = array(
			'Content-Type'          => 'application/json',
			self::HEADER_SITE       => $site_id,
			self::HEADER_KEY        => $collector_key,
		);

		if ( self::signing_enabled() ) {
			$timestamp                        = (string) time();
			$headers[ self::HEADER_TIMESTAMP ] = $timestamp;
			$headers[ self::HEADER_SIGNATURE ] = 'sha256=' . hash_hmac(
				'sha256',
				$timestamp . '.' . $body,
				$collector_key
			);
		}

		return $headers;
	}

	/**
	 * Signing is opt-in until the ScanSite side requires it.
	 *
	 * @return bool
	 */
	public static function signing_enabled() {
		return (bool) get_option( 'scansite_blackbox_signing', false );
	}
}
