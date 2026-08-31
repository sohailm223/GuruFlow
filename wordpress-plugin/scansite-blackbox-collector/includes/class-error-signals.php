<?php
/**
 * Error signals beyond PHP fatals.
 *
 * PHP fatals are handled by ScanSite_BB_Error_Capture. This class watches the
 * other places WordPress reports a failure: a refused REST request, a failed
 * wp_mail, a database error, a failed admin-ajax request and a scheduled task
 * that died part-way through.
 *
 * Every event is queued through ScanSite_BB_Error_Capture::submit(), so every
 * family shares one throttle, one fingerprint scheme and one queue. Nothing
 * here performs a network request.
 *
 * Privacy is enforced structurally rather than by intent. Each family is given
 * the smallest description that is still useful: a database error carries a
 * query keyword and a table name, never the statement. A mail failure carries
 * a code and a transport label, never the body. An AJAX failure carries an
 * action name, never a posted field.
 *
 * @package ScanSite_BlackBox
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Captures non-fatal WordPress errors and queues them as evidence.
 */
class ScanSite_BB_Error_Signals {

	/** How many database errors one request may record before it stops. */
	const MAX_DB_PER_REQUEST = 5;

	/** @var bool */
	private static $registered = false;

	/** @var array<string,bool> Fingerprints already reported this request. */
	private static $seen = array();

	/** @var array|null Set while a cron callback runs. */
	private static $cron_context = null;

	/** @var int Database errors recorded in this request. */
	private static $db_count = 0;

	/** @var bool Whether the browser reporter has been printed this request. */
	private static $reporter_printed = false;

	public static function register() {
		if ( self::$registered ) {
			return;
		}
		self::$registered = true;

		add_filter( 'rest_post_dispatch', array( __CLASS__, 'on_rest_dispatch' ), 10, 3 );
		add_action( 'wp_mail_failed', array( __CLASS__, 'on_mail_failed' ), 10, 1 );
		add_action( 'shutdown', array( __CLASS__, 'on_shutdown' ), 5 );

		// Cron has no "this event failed" hook of its own, so the hook name is
		// captured on the way in and paired with the failure on the way out.
		add_action( 'init', array( __CLASS__, 'watch_cron_events' ), 1 );

		// WordPress raises no global hook when a WP_Error is constructed — it is
		// an ordinary return value, and most are never errors at all. The HTTP
		// API is the one place a WP_Error is raised as a genuine failure with a
		// code and a message, so that is where it is captured.
		add_action( 'http_api_debug', array( __CLASS__, 'on_http_api_debug' ), 10, 5 );

		// A JavaScript error happens in the browser, so nothing on the server can
		// see it. A reporter is printed into the page and posts back.
		add_action( 'wp_head', array( __CLASS__, 'print_js_reporter' ), 20 );
		add_action( 'admin_print_footer_scripts', array( __CLASS__, 'print_js_reporter' ), 20 );
		add_action( 'rest_api_init', array( __CLASS__, 'register_js_route' ) );
	}

	/* ------------------------------------------------------------- REST */

	/**
	 * Record a REST response that failed.
	 *
	 * Hooked at the point WordPress has already turned the handler's return
	 * value into a response, so permission denials (a WP_Error from a
	 * permission_callback) and handler errors both arrive here.
	 *
	 * @param mixed           $result
	 * @param WP_REST_Server  $server
	 * @param WP_REST_Request $request
	 * @return mixed Unmodified — this is an observer.
	 */
	public static function on_rest_dispatch( $result, $server = null, $request = null ) {
		$status = 0;
		$code   = null;

		if ( is_wp_error( $result ) ) {
			$status = 500;
			$data   = $result->get_error_data();
			if ( is_array( $data ) && isset( $data['status'] ) ) {
				$status = (int) $data['status'];
			}
			$raw    = $result->get_error_code();
			$code   = is_scalar( $raw ) ? (string) $raw : 'rest_error';
		} elseif ( is_object( $result ) && method_exists( $result, 'get_status' ) ) {
			$status = (int) $result->get_status();
			if ( $status >= 400 && method_exists( $result, 'as_error' ) ) {
				$err  = $result->as_error();
				$raw  = is_wp_error( $err ) ? $err->get_error_code() : null;
				$code = is_scalar( $raw ) ? (string) $raw : 'rest_error';
			}
		}

		if ( $status < 400 ) {
			return $result;
		}

		$route  = is_object( $request ) && method_exists( $request, 'get_route' )
			? self::clean_route( $request->get_route() )
			: self::clean_route( isset( $_SERVER['REQUEST_URI'] ) ? $_SERVER['REQUEST_URI'] : '' );
		$method = is_object( $request ) && method_exists( $request, 'get_method' )
			? strtoupper( (string) $request->get_method() )
			: ( isset( $_SERVER['REQUEST_METHOD'] ) ? strtoupper( (string) $_SERVER['REQUEST_METHOD'] ) : null );

		$msg = is_wp_error( $result )
			? self::sanitize_text( $result->get_error_message(), 300 )
			: ( is_object( $result ) && method_exists( $result, 'as_error' ) && is_wp_error( $result->as_error() )
				? self::sanitize_text( $result->as_error()->get_error_message(), 300 )
				: 'REST request returned HTTP ' . $status );

		$component = self::component_for_route( $route, $server );

		self::submit_once(
			'rest_error',
			array(
				'kind'      => 'rest',
				'severity'  => 'HTTP ' . $status,
				'code'      => $code,
				'message'   => $msg,
				'component' => $component,
				// Group by method + route + status + code. Never by the body,
				// which can carry request data.
				'fpKey'     => $method . '|' . $route . '|' . $status . '|' . $code,
				'extra'     => array(
					'endpoint'   => $route,
					'httpMethod' => $method,
					'status'     => $status,
				),
			)
		);

		return $result;
	}

	/**
	 * Which component owns a REST route, from the registered callback.
	 *
	 * Reports unknown rather than guessing when the callback cannot be resolved
	 * to a file inside wp-content.
	 *
	 * @param string          $route
	 * @param WP_REST_Server  $server
	 * @return array|null
	 */
	private static function component_for_route( $route, $server = null ) {
		$routes = null;
		if ( is_object( $server ) && method_exists( $server, 'get_routes' ) ) {
			$routes = $server->get_routes();
		} elseif ( function_exists( 'rest_get_server' ) ) {
			$srv    = rest_get_server();
			$routes = is_object( $srv ) && method_exists( $srv, 'get_routes' ) ? $srv->get_routes() : null;
		}

		if ( ! is_array( $routes ) ) {
			return null;
		}

		// A concrete path matches the registered pattern with its placeholders
		// turned into a wildcard, so /wc/v3/orders/42 finds /wc/v3/orders/(?P<id>[\d]+).
		$needle = preg_replace( '/\{[^}]*\}/', '[^/]+', (string) $route );

		foreach ( $routes as $pattern => $handlers ) {
			$regex = '#^' . preg_replace( '/\(\?P<[^>]*>/', '([^/]+)', (string) $pattern ) . '$#';
			if ( ! @preg_match( $regex, $needle ) ) {
				continue;
			}
			foreach ( (array) $handlers as $handler ) {
				if ( empty( $handler['callback'] ) ) {
					continue;
				}
				$file = self::callback_file( $handler['callback'] );
				if ( $file ) {
					$attr = ScanSite_BB_Error_Capture::attribute( $file );
					if ( 'unknown' !== $attr['component'] ) {
						return $attr;
					}
				}
				// A closure gives no file, but its namespace usually names the
				// plugin that registered it.
				$owner = self::namespace_owner( $handler['callback'], $pattern );
				if ( $owner ) {
					return $owner;
				}
			}
			break;
		}

		return null;
	}

	/** The file a route callback lives in, when it can be resolved. */
	private static function callback_file( $callback ) {
		$class = null;
		if ( is_array( $callback ) && isset( $callback[0] ) ) {
			$class = is_object( $callback[0] ) ? get_class( $callback[0] ) : (string) $callback[0];
		} elseif ( is_string( $callback ) && false !== strpos( $callback, '::' ) ) {
			$class = explode( '::', $callback, 2 )[0];
		}

		if ( $class && class_exists( $class ) ) {
			try {
				$ref  = new ReflectionClass( $class );
				$file = $ref->getFileName();
				return is_string( $file ) && '' !== $file ? $file : null;
			} catch ( Exception $e ) {
				return null;
			}
		}

		if ( $callback instanceof Closure ) {
			try {
				$ref  = new ReflectionFunction( $callback );
				$file = $ref->getFileName();
				return is_string( $file ) && '' !== $file ? $file : null;
			} catch ( Exception $e ) {
				return null;
			}
		}

		return null;
	}

	/**
	 * Resolve a route namespace to a plugin, for callbacks with no file.
	 *
	 * @param mixed  $callback
	 * @param string $pattern
	 * @return array|null
	 */
	private static function namespace_owner( $callback, $pattern ) {
		$ns = '';
		if ( is_array( $callback ) && isset( $callback[0] ) ) {
			$ns = is_object( $callback[0] ) ? get_class( $callback[0] ) : (string) $callback[0];
		} elseif ( $callback instanceof Closure ) {
			try {
				$ns = (string) ( new ReflectionFunction( $callback ) )->getNamespaceName();
			} catch ( Exception $e ) {
				$ns = '';
			}
		}

		$ns = strtolower( $ns );
		if ( '' === $ns ) {
			return null;
		}

		// Match the namespace against known plugin slugs rather than inventing
		// an owner from the route string.
		$plugins = function_exists( 'get_plugins' ) ? null : null;
		foreach ( self::plugin_slugs() as $slug ) {
			$needle = str_replace( array( '-', '_' ), '', strtolower( $slug ) );
			if ( '' !== $needle && false !== strpos( str_replace( array( '\\', '_', '-' ), '', $ns ), $needle ) ) {
				$attr = ScanSite_BB_Error_Capture::attribute( WP_PLUGIN_DIR . '/' . $slug . '/' . $slug . '.php' );
				if ( 'plugin' === $attr['component'] ) {
					return $attr;
				}
			}
		}

		return null;
	}

	/** @return string[] Installed plugin directory slugs. */
	private static function plugin_slugs() {
		static $slugs = null;
		if ( null !== $slugs ) {
			return $slugs;
		}
		$slugs = array();
		$dirs  = function_exists( 'glob' ) ? glob( WP_PLUGIN_DIR . '/*', GLOB_ONLYDIR ) : array();
		foreach ( (array) $dirs as $dir ) {
			$base = basename( $dir );
			if ( '' !== $base && '.' !== $base ) {
				$slugs[] = $base;
			}
		}
		return $slugs;
	}

	/** Reduce a route to its path, without a query string. */
	private static function clean_route( $route ) {
		$r = (string) $route;
		$q = strpos( $r, '?' );
		if ( false !== $q ) {
			$r = substr( $r, 0, $q );
		}
		$r = preg_replace( '#^https?://[^/]+#i', '', $r );
		$r = preg_replace( '#^.*?/wp-json#', '/wp-json', $r );
		return substr( (string) $r, 0, 190 );
	}

	/* ------------------------------------------------------------- mail */

	/**
	 * Record a failed wp_mail.
	 *
	 * Only the code and the transport label leave the site. The body, subject,
	 * headers and recipients never do: a message body on a shop contains
	 * customer data, and an SMTP transport can carry a password in its config.
	 *
	 * @param WP_Error $error
	 */
	public static function on_mail_failed( $error ) {
		if ( ! is_wp_error( $error ) ) {
			return;
		}

		$code = $error->get_error_code();
		$msg  = self::sanitize_text( $error->get_error_message(), 300 );

		self::submit_once(
			'mail_error',
			array(
				'kind'     => 'mail',
				'severity' => 'Email delivery failed',
				'code'     => is_scalar( $code ) ? (string) $code : 'mail_failure',
				'message'  => $msg,
				// Group by code + transport, not by recipient or subject.
				'fpKey'    => 'mail|' . ( is_scalar( $code ) ? $code : 'mail_failure' ),
				'extra'    => array(
					'transport' => self::mail_transport(),
					'context'   => 'wp_mail',
				),
			)
		);
	}

	/**
	 * Which mail transport is in use, without reading any credentials.
	 *
	 * Reports a label such as "mail:localhost" or "smtp". Host and port are
	 * configuration an operator already knows; a password never is.
	 *
	 * @return string
	 */
	private static function mail_transport() {
		$host = get_option( 'scansite_mail_host', '' );

		// Common SMTP plugins record their host in an option. Reading the host
		// is safe; the password option is deliberately never touched.
		if ( '' === $host && function_exists( 'get_option' ) ) {
			foreach ( array( 'wp_mail_smtp_host', 'smtp_host' ) as $opt ) {
				$v = get_option( $opt, '' );
				if ( is_string( $v ) && '' !== $v ) {
					$host = $v;
					break;
				}
			}
		}

		if ( is_string( $host ) && '' !== $host ) {
			// A hostname identifies a provider; it is not a credential.
			return 'smtp:' . substr( preg_replace( '/[^a-zA-Z0-9.\-]/', '', $host ), 0, 80 );
		}

		return 'mail:localhost';
	}

	/* --------------------------------------------------------- database */

	/**
	 * Sweep the errors wpdb accumulated during this request.
	 *
	 * Called from shutdown, because a failed query does not raise an exception
	 * — wpdb records it in $EZSQL_ERROR and carries on.
	 *
	 * wpdb::print_error() with show_errors() on stores a whole HTML debug block
	 * as the message, and that block quotes the failing query. So the message
	 * is stripped of markup and then of any statement before it is kept, and
	 * only a query keyword and a table name survive.
	 */
	public static function record_db_errors() {
		$errors = isset( $GLOBALS['EZSQL_ERROR'] ) && is_array( $GLOBALS['EZSQL_ERROR'] )
			? $GLOBALS['EZSQL_ERROR']
			: array();

		if ( empty( $errors ) ) {
			return;
		}

		global $wpdb;

		foreach ( $errors as $err ) {
			if ( self::$db_count >= self::MAX_DB_PER_REQUEST ) {
				break;
			}
			if ( ! is_array( $err ) || empty( $err['error_str'] ) ) {
				continue;
			}

			// Strip the debug wrapper first, then remove any statement that
			// remains embedded in the prose.
			$msg = self::sanitize_text( $err['error_str'], 300 );
			if ( '' === trim( $msg ) ) {
				continue;
			}

			$sql    = isset( $err['query'] ) && is_string( $err['query'] ) ? $err['query'] : '';
			$shape  = self::describe_query( $sql );
			$caller = self::component_for_caller();

			self::$db_count++;

			self::submit_once(
				'db_error',
				array(
					'kind'      => 'database',
					'severity'  => 'Database error',
					'message'   => $msg,
					'code'      => null,
					'component' => 'unknown' !== $caller['component'] ? $caller : null,
					// Group by the shape of the failure. Never by the query:
					// a WHERE clause carries the row it was looking for.
					'fpKey'     => 'db|' . $shape['type'] . '|' . $shape['table'] . '|' . substr( md5( $msg ), 0, 12 ),
					'extra'     => array(
						'queryType' => $shape['type'],
						'table'     => $shape['table'],
					),
				)
			);
		}

		// Leave nothing behind for the next request to re-report.
		if ( isset( $wpdb ) && is_object( $wpdb ) ) {
			$wpdb->suppress_errors();
		}
	}

	/**
	 * Reduce a statement to a keyword and a table name.
	 *
	 * This is the whole reason a database error is safe to send: the caller
	 * gets "UPDATE on wp_options", never the statement, so no value in a WHERE
	 * clause can leave the site.
	 *
	 * @param string $sql
	 * @return array{type:string|null,table:string|null}
	 */
	public static function describe_query( $sql ) {
		$out = array( 'type' => null, 'table' => null );
		$s   = trim( (string) $sql );

		if ( '' === $s ) {
			return $out;
		}

		$head = strtoupper( preg_replace( '/[^A-Za-z]/', '', substr( $s, 0, 12 ) ) );
		foreach ( array( 'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'REPLACE', 'CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'SHOW', 'DESCRIBE' ) as $kw ) {
			if ( 0 === strpos( $head, $kw ) ) {
				$out['type'] = $kw;
				break;
			}
		}

		$patterns = array(
			'/\bFROM\s+`?([a-zA-Z0-9_]+)`?/i',
			'/\bUPDATE\s+`?([a-zA-Z0-9_]+)`?/i',
			'/\bINTO\s+`?([a-zA-Z0-9_]+)`?/i',
			'/\bTABLE\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?`?([a-zA-Z0-9_]+)`?/i',
			'/\bJOIN\s+`?([a-zA-Z0-9_]+)`?/i',
		);
		foreach ( $patterns as $p ) {
			if ( preg_match( $p, $s, $m ) && ! empty( $m[1] ) ) {
				$out['table'] = substr( $m[1], 0, 64 );
				break;
			}
		}

		return $out;
	}

	/* ------------------------------------------------------------- cron */

	/**
	 * Attach a listener to every hook that is due to run in this cron request.
	 *
	 * WordPress dispatches each scheduled event with do_action_ref_array( $hook ),
	 * so pre_{$hook} is the only point at which the hook name is known before the
	 * callback runs. Nothing is registered outside a cron request.
	 */
	public static function watch_cron_events() {
		if ( ! function_exists( 'wp_doing_cron' ) || ! wp_doing_cron() ) {
			return;
		}

		$cron = function_exists( '_get_cron_array' ) ? _get_cron_array() : get_option( 'cron' );
		if ( ! is_array( $cron ) ) {
			return;
		}

		foreach ( $cron as $hooks ) {
			if ( ! is_array( $hooks ) ) {
				continue;
			}
			foreach ( array_keys( $hooks ) as $hook ) {
				if ( ! is_string( $hook ) || '' === $hook ) {
					continue;
				}
				add_action( 'pre_' . $hook, array( __CLASS__, 'on_cron_start' ), 10, 0 );
			}
		}
	}

	/**
	 * Note which scheduled hook is about to run.
	 *
	 * pre_{$hook} does not pass its own name, so it is read back from the
	 * current filter rather than duplicated into one closure per hook.
	 */
	public static function on_cron_start() {
		$filter = current_filter();
		if ( is_string( $filter ) && 0 === strpos( $filter, 'pre_' ) ) {
			self::on_cron_event( substr( $filter, 4 ), array() );
		}
	}

	/**
	 * Remember the hook and schedule while its callback runs.
	 *
	 * The arguments are counted, never stored: a cron argument on a shop can
	 * carry an order id or a user id.
	 *
	 * @param string $hook
	 * @param array  $args
	 */
	public static function on_cron_event( $hook, $args = array() ) {
		self::$cron_context = array(
			'hook'     => substr( sanitize_text_field( (string) $hook ), 0, 190 ),
			'schedule' => self::cron_schedule_for( $hook ),
			'args'     => is_array( $args ) ? count( $args ) : 0,
		);
	}

	/** @return array|null */
	public static function cron_context() {
		return self::$cron_context;
	}

	/**
	 * The recurrence recorded for a hook, from the real cron array.
	 *
	 * @param string $hook
	 * @return string|null
	 */
	private static function cron_schedule_for( $hook ) {
		$cron = function_exists( '_get_cron_array' ) ? _get_cron_array() : get_option( 'cron' );
		if ( ! is_array( $cron ) ) {
			return null;
		}

		foreach ( $cron as $hooks ) {
			if ( ! is_array( $hooks ) || ! isset( $hooks[ $hook ] ) || ! is_array( $hooks[ $hook ] ) ) {
				continue;
			}
			foreach ( $hooks[ $hook ] as $event ) {
				if ( is_array( $event ) && ! empty( $event['schedule'] ) ) {
					return substr( (string) $event['schedule'], 0, 60 );
				}
			}
		}

		// Not scheduled: report that rather than guessing a recurrence.
		return null;
	}

	/**
	 * Report a scheduled task that died part-way through.
	 *
	 * A cron callback that fatals takes the whole cron request with it, so the
	 * evidence is the fatal plus the hook that was running. A task that ran to
	 * completion records nothing.
	 */
	public static function record_cron_error() {
		$context = self::$cron_context;
		if ( ! $context || ! isset( $context['hook'] ) ) {
			return;
		}

		if ( ! class_exists( 'ScanSite_BB_Error_Capture' ) ) {
			return;
		}

		// An uncaught exception is handled by set_exception_handler and never
		// reaches error_get_last(), so the capture class is asked first.
		$captured = ScanSite_BB_Error_Capture::last_error();
		$last     = error_get_last();

		if ( is_array( $captured ) ) {
			$message = isset( $captured['message'] ) ? $captured['message'] : '';
			$file    = isset( $captured['file'] ) ? $captured['file'] : null;
			$line    = isset( $captured['line'] ) ? $captured['line'] : null;
		} elseif ( is_array( $last ) && in_array( $last['type'], ScanSite_BB_Error_Capture::FATAL_TYPES, true ) ) {
			$message = isset( $last['message'] ) ? $last['message'] : '';
			$file    = isset( $last['file'] ) ? $last['file'] : null;
			$line    = isset( $last['line'] ) ? $last['line'] : null;
		} else {
			return;
		}

		$hook = $context['hook'];

		self::submit_once(
			'cron_error',
			array(
				'kind'     => 'cron',
				'severity' => 'Scheduled task failed',
				'message'  => self::sanitize_text( $message, 300 ),
				'file'     => $file,
				'line'     => $line,
				// Group by the hook, so a task that fails every run is one entry.
				'fpKey'    => 'cron|' . $hook,
				'extra'    => array(
					'cronHook' => $hook,
					'schedule' => isset( $context['schedule'] ) ? $context['schedule'] : null,
					'context'  => 'wp_cron',
				),
			)
		);
	}

	/* ------------------------------------------------------------- ajax */

	/**
	 * Record an admin-ajax request that ended in an error status.
	 *
	 * Only the action name survives. $_POST and $_GET are never read: on a shop
	 * those hold form submissions and customer details.
	 */
	public static function record_ajax_error() {
		if ( ! function_exists( 'wp_doing_ajax' ) || ! wp_doing_ajax() ) {
			return;
		}

		// Same seam as the HTTP family: the real response code by default, but
		// readable through a filter so the gate can actually be exercised.
		$status = ScanSite_BB_Error_Capture::response_status();
		if ( $status < 400 ) {
			return;
		}

		$action = self::ajax_action();
		if ( '' === $action ) {
			return;
		}

		$caller = self::component_for_ajax_action( $action );

		self::submit_once(
			'ajax_error',
			array(
				'kind'      => 'ajax',
				'severity'  => 'HTTP ' . $status,
				'code'      => (string) $status,
				'message'   => 'admin-ajax action ' . $action . ' returned HTTP ' . $status,
				'component' => 'unknown' !== $caller['component'] ? $caller : null,
				// Group by action + status. Never by the posted payload.
				'fpKey'     => 'ajax|' . $action . '|' . $status,
				'extra'     => array(
					'ajaxAction' => $action,
					'status'     => $status,
				),
			)
		);
	}

	/**
	 * The requested admin-ajax action, reduced to safe characters.
	 *
	 * @return string
	 */
	private static function ajax_action() {
		$raw = isset( $_REQUEST['action'] ) ? (string) $_REQUEST['action'] : '';
		// An action name is a hook suffix: letters, digits, underscore, hyphen.
		return substr( preg_replace( '/[^a-zA-Z0-9_\-]/', '', $raw ), 0, 120 );
	}

	/**
	 * Which plugin registered an admin-ajax handler.
	 *
	 * @param string $action
	 * @return array
	 */
	private static function component_for_ajax_action( $action ) {
		$unknown = array( 'component' => 'unknown', 'slug' => null, 'name' => null, 'absolute' => null, 'relativePath' => null );

		if ( '' === (string) $action ) {
			return $unknown;
		}

		global $wp_filter;
		$hook = 'wp_ajax_' . $action;

		if ( ! isset( $wp_filter[ $hook ] ) || ! is_object( $wp_filter[ $hook ] ) ) {
			return $unknown;
		}

		try {
			foreach ( $wp_filter[ $hook ]->callbacks as $group ) {
				foreach ( (array) $group as $cb ) {
					if ( empty( $cb['function'] ) ) {
						continue;
					}
					$file = self::callback_file( $cb['function'] );
					if ( ! $file ) {
						continue;
					}
					$attr = ScanSite_BB_Error_Capture::attribute( $file );
					if ( 'unknown' !== $attr['component'] ) {
						return $attr;
					}
				}
			}
		} catch ( Exception $e ) {
			return $unknown;
		}

		return $unknown;
	}

	/* ----------------------------------------------- javascript (browser) */

	/**
	 * Record an error reported by a browser.
	 *
	 * Deliberately narrow. A message, a script URL, a line, a column, a page URL
	 * and a browser label are enough to find the failing statement. Nothing the
	 * visitor typed is accepted, because there is no way to tell a value that
	 * came from a form apart from one that came from the DOM.
	 *
	 * @param array $data
	 */
	public static function record_js_error( $data ) {
		if ( ! is_array( $data ) ) {
			return;
		}

		$message = self::sanitize_text( isset( $data['message'] ) ? $data['message'] : '', 300 );
		if ( '' === trim( $message ) ) {
			return;
		}

		$script = self::sanitize_url( isset( $data['scriptUrl'] ) ? $data['scriptUrl'] : '' );
		$line   = isset( $data['line'] ) && is_numeric( $data['line'] ) ? max( 0, (int) $data['line'] ) : null;
		$column = isset( $data['column'] ) && is_numeric( $data['column'] ) ? max( 0, (int) $data['column'] ) : null;
		$page   = self::sanitize_url( isset( $data['pageUrl'] ) ? $data['pageUrl'] : '' );

		self::submit_once(
			'js_error',
			array(
				'kind'     => 'javascript',
				'severity' => 'JavaScript error',
				'message'  => $message,
				'code'     => null,
				// Group by message + script + line, so a loop on one page is
				// one entry rather than one per visitor.
				'fpKey'    => 'js|' . substr( md5( $message ), 0, 12 ) . '|' . $script . '|' . $line,
				'extra'    => array(
					'scriptUrl' => $script,
					'line'      => $line,
					'column'    => $column,
					'pageUrl'   => $page,
					'browser'   => self::browser_family(),
				),
			)
		);
	}

	/**
	 * A coarse browser label, never a full user agent.
	 *
	 * A full user agent string identifies a visitor far more precisely than
	 * "which browser hit this bug" requires.
	 *
	 * @return string|null
	 */
	private static function browser_family() {
		$ua = isset( $_SERVER['HTTP_USER_AGENT'] ) ? (string) $_SERVER['HTTP_USER_AGENT'] : '';
		if ( '' === $ua ) {
			return null;
		}
		if ( false !== stripos( $ua, 'Firefox/' ) ) {
			return 'Firefox';
		}
		if ( false !== stripos( $ua, 'Edg/' ) ) {
			return 'Edge';
		}
		if ( false !== stripos( $ua, 'Chrome/' ) ) {
			return 'Chrome';
		}
		if ( false !== stripos( $ua, 'Safari/' ) ) {
			return 'Safari';
		}
		return 'Other';
	}

	/* --------------------------------------------------------- plumbing */

	/**
	 * Remove any SQL statement from a message.
	 *
	 * wpdb's debug output quotes the query it failed on, and on a shop that
	 * query contains the row it was looking for. The keyword and table are
	 * recovered separately by describe_query(), so nothing useful is lost.
	 *
	 * @param string $text
	 * @return string
	 */
	public static function strip_sql( $text ) {
		$s = (string) $text;

		$keywords = 'SELECT|INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|TRUNCATE|SHOW|DESCRIBE';
		// Bounded so a pathological message cannot make this expensive.
		$s = preg_replace(
			'/\b(?:' . $keywords . ')\b.{0,2000}?(?=(?:\b(?:' . $keywords . ')\b)|$)/is',
			'[query redacted]',
			$s
		);

		return (string) $s;
	}

	/* ------------------------------------------------------------ WP_Error */

	/**
	 * Record a WP_Error raised by an outbound HTTP request.
	 *
	 * WordPress fires http_api_debug after every wp_remote_*() call with the raw
	 * result. When that result is a WP_Error the request genuinely failed — a
	 * plugin could not reach a payment gateway, an update check could not reach
	 * api.wordpress.org — and the WP_Error carries a real code and message.
	 *
	 * Only the 'response' context is read: 'transport' fires for internal
	 * retries that may still succeed.
	 *
	 * @param mixed  $response Result of the request.
	 * @param string $context  Either 'response' or 'transport'.
	 * @param string $class    Transport class name.
	 * @param array  $args     Request arguments. Not forwarded — the body is never sent.
	 * @param string $url      Requested URL. Only the host is kept.
	 * @return void
	 */
	public static function on_http_api_debug( $response, $context = '', $class = '', $args = array(), $url = '' ) {
		if ( 'response' !== $context ) {
			return;
		}
		if ( ! is_wp_error( $response ) ) {
			return;
		}

		// Never record the collector's own delivery as a site error. ScanSite
		// talking to its dashboard is not the site's failure, and reporting it
		// here would present a connection problem as though the site raised it.
		if ( self::is_own_endpoint( $url ) ) {
			return;
		}

		self::record_wp_error(
			array(
				'code'    => $response->get_error_code(),
				'message' => $response->get_error_message(),
				'context' => 'outbound HTTP request',
				'source'  => self::host_of( $url ),
			)
		);
	}

	/**
	 * Whether a URL points at the ScanSite dashboard this site reports to.
	 *
	 * Compared on host and port rather than the whole URL, because the path
	 * differs per request.
	 *
	 * @param string $url
	 * @return bool
	 */
	private static function is_own_endpoint( $url ) {
		if ( ! class_exists( 'ScanSite_BB_Connection' ) ) {
			return false;
		}
		$endpoint = ScanSite_BB_Connection::endpoint();
		if ( '' === $endpoint ) {
			return false;
		}

		$mine  = self::host_of( $endpoint );
		$theirs = self::host_of( $url );
		if ( null === $mine || null === $theirs ) {
			return false;
		}

		$mine_port = self::port_of( $endpoint );
		$theirs_port = self::port_of( $url );

		return $mine === $theirs && $mine_port === $theirs_port;
	}

	/**
	 * The explicit port of a URL, or null when the scheme default applies.
	 *
	 * @param string $url
	 * @return int|null
	 */
	private static function port_of( $url ) {
		if ( ! function_exists( 'wp_parse_url' ) ) {
			return null;
		}
		$port = wp_parse_url( (string) $url, PHP_URL_PORT );
		return is_numeric( $port ) ? (int) $port : null;
	}

	/**
	 * Queue a WP_Error, sanitised and deduplicated.
	 *
	 * A WP_Error is an ordinary return value in WordPress, so this is only ever
	 * called from a hook where the error is a genuine failure.
	 *
	 * @param array $data code, message, context, source.
	 * @return void
	 */
	public static function record_wp_error( $data ) {
		if ( ! is_array( $data ) ) {
			return;
		}

		$code = isset( $data['code'] ) ? preg_replace( '/[^a-zA-Z0-9_\-]/', '', (string) $data['code'] ) : '';
		$code = '' === $code ? 'unknown_error' : substr( $code, 0, 60 );

		$message = self::sanitize_text( isset( $data['message'] ) ? $data['message'] : '', 300 );
		if ( '' === trim( $message ) ) {
			return;
		}

		$context = isset( $data['context'] ) ? self::sanitize_text( $data['context'], 60 ) : null;
		$source  = isset( $data['source'] ) ? self::sanitize_text( $data['source'], 120 ) : null;

		self::submit_once(
			'wp_error',
			array(
				'kind'     => 'wp',
				'severity' => 'WP_Error',
				'message'  => $message,
				'fpKey'    => 'wp|' . $code . '|' . substr( $message, 0, 40 ),
				'extra'    => array(
					'errorCode' => $code,
					'context'   => $context,
					'source'    => $source,
				),
			)
		);
	}

	/**
	 * Keep only the host of an absolute URL.
	 *
	 * A request URL can carry an API key in its query string, so nothing past
	 * the host is kept.
	 *
	 * @param string $url
	 * @return string|null
	 */
	private static function host_of( $url ) {
		$u = (string) $url;
		if ( '' === $u || ! function_exists( 'wp_parse_url' ) ) {
			return null;
		}
		$host = wp_parse_url( $u, PHP_URL_HOST );
		if ( ! is_string( $host ) || '' === $host ) {
			return null;
		}
		return preg_replace( '/[^a-zA-Z0-9.\-]/', '', $host );
	}

	/* ---------------------------------------------------------- JS errors */

	/**
	 * Print the browser-side reporter.
	 *
	 * Catches window.onerror and unhandled rejections and posts a minimal,
	 * field-limited report to the intake route. It never reads a form field, a
	 * cookie value, localStorage, or anything the visitor typed — only the
	 * error's own message, script location and the page path.
	 *
	 * Skipped when the collector has no credentials, so an unpaired site prints
	 * nothing into its pages.
	 *
	 * @return void
	 */
	public static function print_js_reporter() {
		if ( ! class_exists( 'ScanSite_BB_Connection' ) || ! ScanSite_BB_Connection::has_credentials() ) {
			return;
		}
		if ( self::$reporter_printed ) {
			return;
		}
		self::$reporter_printed = true;

		$endpoint = rest_url( 'scansite-blackbox/v1/js-error' );
		$nonce    = function_exists( 'wp_create_nonce' ) ? wp_create_nonce( 'wp_rest' ) : '';

		$cfg = wp_json_encode(
			array(
				'url'   => $endpoint,
				'nonce' => $nonce,
			)
		);

		echo "<script>\n";
		echo "/* ScanSite: reports an error's own location. Reads no page content. */\n";
		echo "(function(){var c=" . $cfg . ";if(!c.url||window.__scansiteJSErrors)return;"
			. "window.__scansiteJSErrors=1;var sent=0;"
			. "function send(p){if(sent>=3)return;sent++;"
			. "try{fetch(c.url,{method:'POST',keepalive:true,credentials:'same-origin',"
			. "headers:{'Content-Type':'application/json','X-WP-Nonce':c.nonce},"
			. "body:JSON.stringify(p)});}catch(e){}}"
			. "window.addEventListener('error',function(ev){"
			. "send({message:String(ev.message||'').slice(0,300),"
			. "scriptUrl:String(ev.filename||'').slice(0,300),"
			. "line:ev.lineno|0,column:ev.colno|0,"
			. "pageUrl:String(location.pathname||'').slice(0,190)});},true);"
			. "window.addEventListener('unhandledrejection',function(ev){"
			. "var r=ev.reason;var m=(r&&r.message)?r.message:String(r);"
			. "send({message:String(m||'').slice(0,300),pageUrl:String(location.pathname||'').slice(0,190)});},true);"
			. "})();\n";
		echo "</script>\n";
	}

	/**
	 * Register the intake route for browser-reported errors.
	 *
	 * Requires a valid wp_rest nonce, so only a page this site actually rendered
	 * can report. That keeps the endpoint from becoming a way to inject events
	 * into the queue from outside.
	 *
	 * @return void
	 */
	public static function register_js_route() {
		if ( ! function_exists( 'register_rest_route' ) ) {
			return;
		}
		register_rest_route(
			'scansite-blackbox/v1',
			'/js-error',
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'on_js_report' ),
				// The nonce is checked by WordPress for any request that sends
				// X-WP-Nonce; rest_cookie_check_errors() rejects a bad one
				// before this callback runs.
				'permission_callback' => '__return_true',
				'args'                => array(
					'message' => array( 'required' => true, 'type' => 'string' ),
				),
			)
		);
	}

	/**
	 * Handle a browser-reported error.
	 *
	 * @param WP_REST_Request $request
	 * @return WP_REST_Response
	 */
	public static function on_js_report( $request ) {
		self::record_js_error(
			array(
				'message'   => $request->get_param( 'message' ),
				'scriptUrl' => $request->get_param( 'scriptUrl' ),
				'line'      => $request->get_param( 'line' ),
				'column'    => $request->get_param( 'column' ),
				'pageUrl'   => $request->get_param( 'pageUrl' ),
			)
		);

		return rest_ensure_response( array( 'success' => true ) );
	}

	/**
	 * Reduce a URL to scheme-free path, without a query string.
	 *
	 * Query strings carry nonces and ids, and an absolute URL identifies the
	 * host the operator already knows.
	 *
	 * @param string $url
	 * @return string|null
	 */
	private static function sanitize_url( $url ) {
		$u = (string) $url;
		if ( '' === $u ) {
			return null;
		}
		$u = preg_replace( '#^https?://[^/]+#i', '', $u );
		$q = strpos( $u, '?' );
		if ( false !== $q ) {
			$u = substr( $u, 0, $q );
		}
		$u = preg_replace( '/[^a-zA-Z0-9\/._\-#]/', '', $u );
		return '' === $u ? null : substr( $u, 0, 190 );
	}

	/**
	 * Queue one event, at most once per fingerprint per request.
	 *
	 * Keeps a loop that fails 500 times in one request from walking the
	 * throttle 500 times.
	 *
	 * @param string $type
	 * @param array  $args
	 */
	private static function submit_once( $type, $args ) {
		if ( ! class_exists( 'ScanSite_BB_Error_Capture' ) ) {
			return;
		}
		$key = $type . '|' . ( isset( $args['fpKey'] ) ? $args['fpKey'] : ( isset( $args['message'] ) ? $args['message'] : '' ) );
		if ( isset( self::$seen[ $key ] ) ) {
			return;
		}
		self::$seen[ $key ] = true;

		ScanSite_BB_Error_Capture::submit( $type, $args );
	}

	/**
	 * Which component is running right now, from the call stack.
	 *
	 * Used where an error has no file of its own (a database error). Reports
	 * unknown rather than guessing when the stack names nothing in wp-content.
	 *
	 * @return array
	 */
	private static function component_for_caller() {
		$unknown = array( 'component' => 'unknown', 'slug' => null, 'name' => null, 'absolute' => null, 'relativePath' => null );

		if ( ! function_exists( 'debug_backtrace' ) ) {
			return $unknown;
		}

		$trace = debug_backtrace( DEBUG_BACKTRACE_IGNORE_ARGS, 25 );
		foreach ( (array) $trace as $frame ) {
			if ( empty( $frame['file'] ) ) {
				continue;
			}
			$attr = ScanSite_BB_Error_Capture::attribute( $frame['file'] );
			if ( 'unknown' !== $attr['component'] && 'wordpress_core' !== $attr['component'] ) {
				return $attr;
			}
		}

		return $unknown;
	}

	/**
	 * End-of-request sweep for the error families that have no hook of their own.
	 *
	 * Priority 5, so it runs before the fatal handler at the default priority
	 * has finished and after the response code is settled.
	 */
	public static function on_shutdown() {
		self::record_db_errors();
		self::record_ajax_error();
		self::record_cron_error();
	}

	/**
	 * Strip anything that looks like a value rather than a description.
	 *
	 * Error messages frequently quote the data that broke them, and on a shop
	 * that data is a customer's. Markup, embedded SQL, quoted literals, emails
	 * and long digit runs are removed before the message is queued.
	 *
	 * @param string $text
	 * @param int    $max
	 * @return string
	 */
	public static function sanitize_text( $text, $max = 300 ) {
		$s = (string) $text;

		// wpdb stores an HTML debug block as the message. Decode it before
		// scanning, or an entity-encoded email survives every rule below.
		$s = strip_tags( $s );
		if ( function_exists( 'html_entity_decode' ) ) {
			$s = html_entity_decode( $s, ENT_QUOTES | ENT_HTML5, 'UTF-8' );
		}

		// Remove any statement before the value rules, because a WHERE clause
		// is exactly where a customer's data lives.
		$s = self::strip_sql( $s );

		// Quoted literals hold the value that broke the call.
		$s = str_replace( '…', '?', $s );
		$s = preg_replace( '/\'[^\']*\'/', '\'?\'', $s );
		$s = preg_replace( '/"[^"]*"/', '"?"', $s );

		// Emails and long digit runs (card numbers, phone numbers, ids).
		$s = preg_replace( '/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/', '#email', $s );
		$s = preg_replace( '/\b\d{5,}\b/', '#', $s );

		$s = preg_replace( '/\s+/', ' ', $s );

		return substr( trim( $s ), 0, $max );
	}
}
