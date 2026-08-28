<?php
/**
 * Request signing.
 *
 * Every request to ScanSite is HMAC-signed; signing is mandatory, not opt-in.
 * The signature covers the timestamp, a single-use nonce and the raw body so a
 * captured request cannot be replayed:
 *
 *   X-ScanSite-Signature = sha256=HMAC( key, timestamp . '.' . nonce . '.' . body )
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class ScanSite_BB_Signing {

	const HEADER_SITE      = 'X-ScanSite-Site';
	const HEADER_KEY       = 'X-ScanSite-Key';
	const HEADER_TIMESTAMP = 'X-ScanSite-Timestamp';
	const HEADER_NONCE     = 'X-ScanSite-Nonce';
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
		$timestamp = (string) time();
		$nonce     = self::nonce();

		return array(
			'Content-Type'          => 'application/json',
			self::HEADER_SITE       => $site_id,
			self::HEADER_KEY        => $collector_key,
			self::HEADER_TIMESTAMP  => $timestamp,
			self::HEADER_NONCE      => $nonce,
			self::HEADER_SIGNATURE  => 'sha256=' . hash_hmac(
				'sha256',
				$timestamp . '.' . $nonce . '.' . $body,
				$collector_key
			),
		);
	}

	/**
	 * A single-use, high-entropy nonce so ScanSite can reject replays.
	 *
	 * @return string 32 hex chars
	 */
	private static function nonce() {
		if ( function_exists( 'wp_generate_password' ) ) {
			return strtolower( wp_generate_password( 32, false, false ) );
		}
		return bin2hex( random_bytes( 16 ) );
	}
}
