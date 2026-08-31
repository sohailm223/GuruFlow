<?php
/**
 * Error capture.
 *
 * Records PHP fatal errors, uncaught exceptions and HTTP 5xx responses as
 * Black Box events, so the dashboard can show exactly where an error happened,
 * which component owns the file, and what changed beforehand.
 *
 * Three hard rules:
 *
 *  1. Nothing here performs a network request. A fatal-error shutdown is the
 *     worst possible moment to block on HTTP — the request is already failing
 *     and the web server may be out of time. Events go onto the same
 *     ScanSite_BB_Events queue as everything else and leave on WP-Cron.
 *  2. Nothing here reads or sends file contents. The payload carries a path
 *     and a line number, never source.
 *  3. Nothing here guesses a cause. It reports the error and the file that
 *     raised it; correlation happens server-side against recorded events.
 *
 * Registration happens when this file loads, which is during plugin loading,
 * after WordPress core is available. Errors raised before that point cannot be
 * queued because there is no database yet — the handler checks and bails
 * quietly rather than throwing a second error on top of the first.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class ScanSite_BB_Error_Capture {

	/** Rolling per-fingerprint counters, so repeats do not flood the queue. */
	const OPT_STATE = 'scansite_blackbox_error_state';

	/** Minimum seconds between two queued reports of the same fingerprint. */
	const REPORT_INTERVAL = 60;

	/** Distinct fingerprints tracked before the oldest are dropped. */
	const MAX_TRACKED = 200;

	/**
	 * Error severities that mean "this request did not complete". Warnings and
	 * notices are deliberately excluded: they are not failures, and reporting
	 * them would bury the errors that matter.
	 */
	/**
	 * Statuses worth recording as an error in their own right.
	 *
	 * Client errors are included because a 403 on an API route is usually a
	 * permission callback or an expired credential, which is exactly the kind of
	 * thing that starts failing after an update.
	 *
	 * @var int[]
	 */
	const HTTP_ERROR_STATUSES = array( 400, 401, 403, 404, 429, 500, 502, 503, 504 );

	/** @var array|null The error this request failed with, if any. */
	private static $last_error = null;

	/**
	 * The error captured so far in this request.
	 *
	 * Exposed so a later sweep can tell the request failed even when the failure
	 * came through the exception handler, which leaves error_get_last() empty.
	 *
	 * @return array|null
	 */
	public static function last_error() {
		return self::$last_error;
	}

	const FATAL_TYPES = array(
		E_ERROR,
		E_PARSE,
		E_CORE_ERROR,
		E_COMPILE_ERROR,
		E_USER_ERROR,
		E_RECOVERABLE_ERROR,
	);

	/** @var bool Guard against re-entering the handler if it errors itself. */
	private static $running = false;

	/** @var bool Already registered this request. */
	private static $registered = false;

	/**
	 * Install the handlers. Safe to call more than once.
	 */
	public static function register() {
		if ( self::$registered ) {
			return;
		}
		self::$registered = true;

		register_shutdown_function( array( __CLASS__, 'on_shutdown' ) );
		set_exception_handler( array( __CLASS__, 'on_exception' ) );
	}

	/* ------------------------------------------------------------ shutdown */

	/**
	 * Capture a fatal error and any HTTP 5xx response.
	 */
	public static function on_shutdown() {
		if ( self::$running ) {
			return;
		}
		self::$running = true;

		$error = error_get_last();
		if ( $error && in_array( $error['type'], self::FATAL_TYPES, true ) ) {
			self::capture_php_error( $error );
		}

		self::capture_http_error();

		self::$running = false;
	}

	/**
	 * Capture an uncaught exception. Exceptions carry a stack trace, so the
	 * originating file is usually more useful than where it surfaced.
	 *
	 * @param Throwable $e
	 */
	public static function on_exception( $e ) {
		if ( self::$running ) {
			return;
		}
		self::$running = true;

		self::record(
			array(
				'errorClass' => get_class( $e ),
				'kind'       => 'exception',
				'severity'   => self::label_for_type( E_ERROR ),
				'message'    => $e->getMessage(),
				'file'       => $e->getFile(),
				'line'       => $e->getLine(),
				'code'       => is_scalar( $e->getCode() ) ? (string) $e->getCode() : null,
			)
		);

		self::capture_http_error();

		self::$running = false;
	}

	/**
	 * Turn a PHP error array into an event.
	 *
	 * @param array $error Output of error_get_last().
	 */
	private static function capture_php_error( $error ) {
		self::record(
			array(
				'errorClass' => null,
				'kind'       => 'fatal',
				'severity'   => self::label_for_type( (int) $error['type'] ),
				'message'    => isset( $error['message'] ) ? $error['message'] : '',
				'file'       => isset( $error['file'] ) ? $error['file'] : null,
				'line'       => isset( $error['line'] ) ? (int) $error['line'] : null,
				'code'       => (string) (int) $error['type'],
			)
		);
	}

	/**
	 * Record an HTTP 5xx response, if the response code is still readable.
	 *
	 * A 500 with no PHP fatal is real evidence on its own — it means the
	 * request failed and nothing in the log explains why yet.
	 */
	private static function capture_http_error() {
		$status = self::response_status();
		if ( ! in_array( $status, self::HTTP_ERROR_STATUSES, true ) ) {
			return;
		}

		self::submit(
			'http_error',
			array(
				'kind'     => 'http',
				'severity' => 'HTTP ' . $status,
				'message'  => 'Server returned HTTP ' . $status,
				'code'     => (string) $status,
				// Group by status + route, never by the full URL: query strings
				// carry nonces, and numeric ids would split one route into
				// thousands of one-off "errors".
				'fpKey'    => $status . '|' . self::normalise_route( self::request_path() ),
				'extra'    => array(
					'status'         => $status,
					'responseTimeMs' => self::response_time_ms(),
				),
			)
		);
	}

	/**
	 * Collapse the volatile parts of a route so one endpoint groups together.
	 *
	 * /wp-json/wc/v3/orders/1234 and /wp-json/wc/v3/orders/5678 are the same
	 * endpoint failing, not two unrelated errors.
	 *
	 * @param string|null $path
	 * @return string
	 */
	public static function normalise_route( $path ) {
		$p = (string) $path;

		// UUIDs first. Once the digits are masked a UUID no longer matches its
		// own pattern, so every distinct id would group separately -- the exact
		// split this method exists to prevent.
		$p = preg_replace( '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i', '#uuid', $p );

		// Then mask id segments. The lookbehind leaves an API version such as
		// /v3/ intact: v3 and v4 are different endpoints, and collapsing them
		// would hide which one is failing.
		$p = preg_replace( '/(?<![a-z])\d+/', '#', $p );

		return $p;
	}

	/**
	 * Milliseconds since the request started, when the server provides it.
	 *
	 * Reported only as a duration. Nothing about the response body is read.
	 *
	 * @return int|null
	 */
	/**
	 * The status this request ended with.
	 *
	 * Read through a filter because http_response_code() is a no-op under
	 * php-wasm, which would otherwise make the whole capture path untestable.
	 * The default is the real response code, so production behaviour is
	 * unchanged; the seam exists so a test can drive the gate that decides
	 * whether a response counts as an error.
	 *
	 * @return int
	 */
	public static function response_status() {
		$status = function_exists( 'http_response_code' ) ? (int) http_response_code() : 0;
		return (int) apply_filters( 'scansite_blackbox_response_status', $status );
	}

	private static function response_time_ms() {
		$start = isset( $_SERVER['REQUEST_TIME_FLOAT'] ) ? (float) $_SERVER['REQUEST_TIME_FLOAT'] : 0.0;
		if ( $start <= 0 ) {
			return null;
		}
		$ms = ( microtime( true ) - $start ) * 1000;
		return $ms > 0 ? (int) round( $ms ) : null;
	}

	/* -------------------------------------------------------------- record */

	/**
	 * Build the event and push it onto the collector queue.
	 *
	 * Repeats of the same fingerprint are counted locally and re-reported at
	 * most once per REPORT_INTERVAL, carrying how many occurred since the last
	 * report. That keeps a crash loop from filling the queue while still
	 * preserving the true total and the first/last times.
	 *
	 * @param array  $error Normalised error fields.
	 * @param string $type  Event type.
	 */
	private static function record( $error, $type = 'php_error' ) {
		// Remember what this request failed with. An uncaught exception is
		// handled by set_exception_handler and never reaches error_get_last(),
		// so a later sweep cannot rely on that alone to know a failure happened.
		self::$last_error = $error;

		self::submit(
			$type,
			array(
				'kind'       => $error['kind'],
				'severity'   => $error['severity'],
				'errorClass' => $error['errorClass'],
				'code'       => $error['code'],
				'message'    => $error['message'],
				'file'       => $error['file'],
				'line'       => $error['line'],
			)
		);
	}

	/**
	 * Queue one error event of any kind.
	 *
	 * Every error family -- PHP, HTTP, REST, AJAX, database, mail, cron,
	 * JavaScript -- funnels through here so they all share one throttle, one
	 * fingerprint scheme and one queue. Nothing in this method performs a
	 * network request.
	 *
	 * @param string $type Event type, e.g. php_error, rest_error, db_error.
	 * @param array  $args {
	 *     @type string      $kind       Family id.
	 *     @type string|null $severity   Human label, e.g. "Fatal error".
	 *     @type string|null $message    Sanitised message.
	 *     @type string|null $code       Error or status code.
	 *     @type string|null $errorClass Exception class, when there is one.
	 *     @type string|null $file       Absolute file, when the error has one.
	 *     @type int|null    $line       Line number, when the error has one.
	 *     @type array|null  $component  Pre-resolved component from attribute().
	 *     @type string|null $fpKey      Explicit grouping key. Without it the
	 *                                     legacy message-based fingerprint is
	 *                                     used, so PHP behaviour is unchanged.
	 *     @type array|null  $extra      Extra scalar metadata. Values that are
	 *                                     not scalar are dropped rather than
	 *                                     serialised, so an object holding
	 *                                     private data can never be leaked.
	 * }
	 */
	public static function submit( $type, $args ) {
		if ( ! function_exists( 'get_option' ) || ! class_exists( 'ScanSite_BB_Events' ) ) {
			return;
		}

		// An unconnected collector has nowhere to send this, and queueing would
		// only fill wp_options on a site that is not being monitored.
		if ( ! ScanSite_BB_Connection::has_credentials() ) {
			return;
		}

		// A caller that already knows the component (a REST route owned by a
		// plugin, say) says so; otherwise it is derived from the failing file.
		$component = isset( $args['component'] ) && is_array( $args['component'] )
			? $args['component']
			: self::attribute( isset( $args['file'] ) ? $args['file'] : null );

		$severity = isset( $args['severity'] ) ? $args['severity'] : null;
		$message  = isset( $args['message'] ) ? $args['message'] : '';
		$line     = isset( $args['line'] ) ? $args['line'] : null;

		$fp = isset( $args['fpKey'] ) && '' !== $args['fpKey']
			? substr( md5( $type . '|' . $args['fpKey'] ), 0, 24 )
			: self::fingerprint( $severity, $message, $component['relativePath'], $line );

		$now = time();

		$state = get_option( self::OPT_STATE, array() );
		if ( ! is_array( $state ) ) {
			$state = array();
		}

		$entry = isset( $state[ $fp ] ) && is_array( $state[ $fp ] ) ? $state[ $fp ] : null;
		if ( $entry ) {
			$entry['count'] = (int) $entry['count'] + 1;
			$entry['last']  = $now;
		} else {
			$entry = array(
				'count'         => 1,
				'first'         => $now,
				'last'          => $now,
				'reportedAt'    => 0,
				'reportedCount' => 0,
			);
		}

		$due = 0 === (int) $entry['reportedAt'] || ( $now - (int) $entry['reportedAt'] ) >= self::REPORT_INTERVAL;
		if ( ! $due ) {
			$state[ $fp ] = $entry;
			self::save_state( $state, $now );
			return;
		}

		$occurrences            = (int) $entry['count'] - (int) $entry['reportedCount'];
		$entry['reportedAt']    = $now;
		$entry['reportedCount'] = (int) $entry['count'];
		$state[ $fp ]           = $entry;
		self::save_state( $state, $now );

		$metadata = array(
			'fingerprint'   => $fp,
			'kind'          => isset( $args['kind'] ) ? $args['kind'] : null,
			'severity'      => $severity,
			'errorClass'    => isset( $args['errorClass'] ) ? $args['errorClass'] : null,
			'code'          => isset( $args['code'] ) ? $args['code'] : null,
			'message'       => self::truncate( $message, 500 ),
			'file'          => $component['absolute'],
			'relativePath'  => $component['relativePath'],
			'line'          => null === $line ? null : (int) $line,
			'component'     => $component['component'],
			'componentSlug' => $component['slug'],
			'componentName' => $component['name'],
			'occurrences'   => max( 1, $occurrences ),
			'totalSeen'     => (int) $entry['count'],
			'firstSeen'     => (int) $entry['first'],
			'lastSeen'      => (int) $entry['last'],
			'requestPath'   => self::request_path(),
			'requestMethod' => self::request_method(),
			'phpVersion'    => PHP_VERSION,
		);

		// Family-specific detail. Scalars and null only, so nothing structured
		// can smuggle a nested value past the sanitiser.
		foreach ( (array) ( isset( $args['extra'] ) ? $args['extra'] : array() ) as $k => $v ) {
			if ( is_scalar( $v ) || null === $v ) {
				$metadata[ $k ] = $v;
			}
		}

		$events = new ScanSite_BB_Events();
		$events->enqueue( $type, 'error', array( 'metadata' => $metadata ) );
	}

	/** Persist the rolling counters, bounded so a long-lived site cannot grow this forever. */
	private static function save_state( $state, $now ) {
		if ( count( $state ) > self::MAX_TRACKED ) {
			uasort(
				$state,
				static function ( $a, $b ) use ( $now ) {
					$al = isset( $a['last'] ) ? (int) $a['last'] : 0;
					$bl = isset( $b['last'] ) ? (int) $b['last'] : 0;
					return $bl <=> $al;
				}
			);
			$state = array_slice( $state, 0, self::MAX_TRACKED, true );
		}
		update_option( self::OPT_STATE, $state, false );
	}

	/* --------------------------------------------------------- attribution */

	/**
	 * Work out which component owns a file path.
	 *
	 * Returns the same shape for every input so consumers never need to
	 * null-check: an unattributable path is reported as "unknown" with a null
	 * slug, never guessed.
	 *
	 * @param string|null $file Absolute path from the error, if any.
	 * @return array{component:string,slug:?string,name:?string,absolute:?string,relativePath:?string}
	 */
	public static function attribute( $file ) {
		$out = array(
			'component'    => 'unknown',
			'slug'         => null,
			'name'         => null,
			'absolute'     => null,
			'relativePath' => null,
		);

		if ( ! is_string( $file ) || '' === $file ) {
			return $out;
		}

		$abs           = self::normalise_path( $file );
		$out['absolute'] = $file;

		// ABSPATH is a directory, so it keeps its trailing separator; the file
		// path must not gain one, or every relative path ends in a stray slash.
		$root = self::normalise_dir( ABSPATH );
		$rel  = 0 === strpos( $abs, $root ) ? substr( $abs, strlen( $root ) ) : null;
		$out['relativePath'] = $rel;

		// Outside the WordPress root entirely: a server-level or system file.
		if ( null === $rel ) {
			$out['component'] = 'external';
			return $out;
		}

		$rel = ltrim( str_replace( '\\', '/', $rel ), '/' );

		// Config first: wp-config.php and .htaccess live at the root and would
		// otherwise fall through to "core".
		if ( 'wp-config.php' === $rel || '.htaccess' === $rel ) {
			$out['component'] = 'config';
			$out['name']      = $rel;
			return $out;
		}

		if ( 0 === strpos( $rel, 'wp-admin/' ) || 0 === strpos( $rel, 'wp-includes/' ) ) {
			$out['component'] = 'core';
			$out['name']      = 'WordPress Core';
			return $out;
		}

		if ( 0 === strpos( $rel, 'wp-content/mu-plugins/' ) ) {
			$out['component'] = 'mu_plugin';
			$out['slug']      = self::segment( $rel, 2 );
			$out['name']      = $out['slug'];
			return $out;
		}

		if ( 0 === strpos( $rel, 'wp-content/plugins/' ) ) {
			$out['component'] = 'plugin';
			$out['slug']      = self::segment( $rel, 2 );
			$out['name']      = self::plugin_display_name( $out['slug'], $rel );
			return $out;
		}

		if ( 0 === strpos( $rel, 'wp-content/themes/' ) ) {
			$out['component'] = 'theme';
			$out['slug']      = self::segment( $rel, 2 );
			$out['name']      = self::theme_display_name( $out['slug'] );
			return $out;
		}

		if ( 0 === strpos( $rel, 'wp-content/uploads/' ) ) {
			$out['component'] = 'uploads';
			$out['name']      = 'Uploads';
			return $out;
		}

		if ( 0 === strpos( $rel, 'wp-content/' ) ) {
			$out['component'] = 'content';
			$out['name']      = 'wp-content';
			return $out;
		}

		// Anything else at the root (index.php, wp-load.php, wp-settings.php).
		$out['component'] = 'core';
		$out['name']      = 'WordPress Core';
		return $out;
	}

	/** Resolve a plugin slug to its real name from the plugin header, if readable. */
	private static function plugin_display_name( $slug, $rel ) {
		if ( ! $slug ) {
			return null;
		}

		$base = WP_PLUGIN_DIR . '/' . $slug;
		if ( is_readable( $base . '/' . $slug . '.php' ) ) {
			$header = $base . '/' . $slug . '.php';
		} else {
			// The failing file may be nested; find any plugin header under the slug.
			$header = self::find_plugin_header( $base );
		}

		if ( $header && function_exists( 'get_plugin_data' ) ) {
			$data = get_plugin_data( $header, false, false );
			if ( ! empty( $data['Name'] ) ) {
				return $data['Name'];
			}
		}

		return $slug;
	}

	/** Locate a plugin's main file by looking for a Plugin Name header. */
	private static function find_plugin_header( $dir ) {
		if ( ! is_dir( $dir ) || ! function_exists( 'get_file_data' ) ) {
			return null;
		}

		$entries = @scandir( $dir );
		if ( ! is_array( $entries ) ) {
			return null;
		}

		foreach ( $entries as $entry ) {
			if ( '.' === $entry[0] || ! preg_match( '/\.php$/', $entry ) ) {
				continue;
			}
			$path = $dir . '/' . $entry;
			$data = get_file_data( $path, array( 'Name' => 'Plugin Name' ) );
			if ( ! empty( $data['Name'] ) ) {
				return $path;
			}
		}

		return null;
	}

	/** Resolve a theme slug to its stylesheet name. */
	private static function theme_display_name( $slug ) {
		if ( ! $slug || ! function_exists( 'wp_get_theme' ) ) {
			return $slug;
		}
		$theme = wp_get_theme( $slug );
		return $theme->exists() ? $theme->get( 'Name' ) : $slug;
	}

	/** Nth path segment, or null when the path is too shallow to have one. */
	private static function segment( $rel, $index ) {
		$parts = explode( '/', $rel );
		return isset( $parts[ $index ] ) && '' !== $parts[ $index ] ? $parts[ $index ] : null;
	}

	/* --------------------------------------------------------- fingerprint */

	/**
	 * Stable identity for a repeated error.
	 *
	 * Type + normalised message + file + line. The message is normalised so
	 * that values which change between occurrences (ids, paths, hex addresses)
	 * do not split one recurring error into many.
	 *
	 * @param string      $severity
	 * @param string      $message
	 * @param string|null $file
	 * @param int|null    $line
	 * @return string
	 */
	public static function fingerprint( $severity, $message, $file, $line ) {
		return substr( md5( self::normalise_message( $message ) . '|' . $severity . '|' . $file . '|' . $line ), 0, 24 );
	}

	/**
	 * Strip the variable parts out of an error message.
	 *
	 * @param string $message
	 * @return string
	 */
	public static function normalise_message( $message ) {
		$m = strtolower( (string) $message );

		// Strip any "Uncaught ...:" prefix so the same underlying error is not
		// split by how PHP happened to phrase the wrapper.
		$m = preg_replace( '/^uncaught\s+[a-z0-9_\\\\]*(error|exception|throwable)\s*:\s*/', '', $m );

		$m = preg_replace( '/0x[0-9a-f]+/', '#addr', $m );      // memory addresses
		$m = preg_replace( '/\d+/', '#', $m );                   // ids, counts, line refs
		$m = preg_replace( '/[\'"][^\'"]*[\'"]/', '"?"', $m );   // quoted values
		$m = preg_replace( '/\s+/', ' ', $m );

		return trim( (string) $m );
	}

	/* ------------------------------------------------------------- helpers */

	/** Human-readable severity label for a PHP error constant. */
	private static function label_for_type( $type ) {
		$labels = array(
			E_ERROR             => 'Fatal error',
			E_PARSE             => 'Parse error',
			E_CORE_ERROR        => 'Core error',
			E_COMPILE_ERROR     => 'Compile error',
			E_USER_ERROR        => 'User error',
			E_RECOVERABLE_ERROR => 'Recoverable fatal error',
		);
		return isset( $labels[ $type ] ) ? $labels[ $type ] : 'Error';
	}

	/**
	 * Request path without the query string.
	 *
	 * Query strings are dropped on purpose: they routinely carry nonces and
	 * tokens, and the route alone is what identifies the failing request.
	 *
	 * @return string|null
	 */
	private static function request_path() {
		if ( ! isset( $_SERVER['REQUEST_URI'] ) ) {
			return null;
		}
		$uri   = sanitize_text_field( wp_unslash( $_SERVER['REQUEST_URI'] ) );
		$query = strpos( $uri, '?' );
		return false === $query ? $uri : substr( $uri, 0, $query );
	}

	/** @return string|null */
	private static function request_method() {
		return isset( $_SERVER['REQUEST_METHOD'] )
			? sanitize_text_field( wp_unslash( $_SERVER['REQUEST_METHOD'] ) )
			: null;
	}

	/** Collapse path separators so comparisons are reliable. */
	private static function normalise_path( $path ) {
		return str_replace( '\\', '/', (string) $path );
	}

	/** Collapse path separators and guarantee a trailing separator. */
	private static function normalise_dir( $path ) {
		$p = self::normalise_path( $path );
		return '/' === substr( $p, -1 ) ? $p : $p . '/';
	}

	/** @return string */
	private static function truncate( $text, $max ) {
		$text = (string) $text;
		return strlen( $text ) > $max ? substr( $text, 0, $max ) : $text;
	}
}
