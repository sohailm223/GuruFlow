<?php
/**
 * Lab helpers — loaded after wp-load.php for every PHP run.
 *
 * These exist only to let the test harness observe the collector. They are not
 * part of the shipped plugin and never call ScanSite themselves.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** Raw queue contents as stored by the collector. */
function lab_queue() {
	$q = get_option( ScanSite_BB_Events::OPT_QUEUE, array() );
	return is_array( $q ) ? $q : array();
}

/** Print the queue as JSON under a stable marker. */
function lab_dump_queue() {
	echo '@@QUEUE@@' . wp_json_encode( lab_queue() ) . '@@END@@' . "\n";
}

/** Print a single JSON value under a marker. */
function lab_dump( $label, $value ) {
	echo '@@' . $label . '@@' . wp_json_encode( $value ) . '@@END@@' . "\n";
}

function lab_clear_queue() {
	update_option( ScanSite_BB_Events::OPT_QUEUE, array(), false );
}

/** Run the collector's real delivery path. */
function lab_flush() {
	ScanSite_BB_Collector::instance()->flush();
}

/** Fire admin_init so config-file watching runs, as it does in wp-admin. */
function lab_admin_init() {
	do_action( 'admin_init' );
}

/**
 * Reproduce what a real wp-admin page request provides before a settings page
 * renders. wp-admin/admin.php requires wp-admin/includes/admin.php, which in
 * turn loads template.php (submit_button) and plugin.php (get_plugins).
 *
 * Without this, admin-only helpers are undefined — which is a harness bug, not
 * a plugin bug, so it must be set up faithfully.
 */
function lab_admin_context() {
	require_once ABSPATH . 'wp-admin/includes/admin.php';

	$ids = get_users( array( 'role' => 'administrator', 'number' => 1, 'fields' => 'ids' ) );
	if ( ! empty( $ids ) ) {
		wp_set_current_user( (int) $ids[0] );
	}

	do_action( 'admin_menu' );

	return get_current_user_id();
}

/** Timing helper. */
function lab_ms( callable $fn ) {
	$t = microtime( true );
	$out = $fn();
	return array( 'ms' => round( ( microtime( true ) - $t ) * 1000, 2 ), 'out' => $out );
}

/**
 * Run a WordPress action in isolation and report exactly what the collector
 * queued as a result. Clearing first is what makes duplicate detection honest.
 *
 * @param string   $label
 * @param callable $fn
 */
function lab_capture( $label, callable $fn ) {
	lab_clear_queue();
	$before = microtime( true );
	$out    = $fn();

	// A real request always runs its shutdown hooks before ending, and some
	// collector events are deliberately deferred to that point. Running them
	// here keeps the harness honest about end-of-request behaviour.
	do_action( 'shutdown' );

	$ms = round( ( microtime( true ) - $before ) * 1000, 2 );

	lab_dump(
		$label,
		array(
			'events' => lab_queue(),
			'ms'     => $ms,
			'error'  => is_wp_error( $out ) ? $out->get_error_message() : null,
		)
	);
}

/** Compact event summary: type plus a couple of identifying fields. */
function lab_types( $events ) {
	return array_map(
		function ( $e ) {
			return isset( $e['type'] ) ? $e['type'] : '?';
		},
		(array) $events
	);
}

/**
 * Log the admin in for the current request. Each PHP run is a fresh process, so
 * without this there is no current user and actor data is legitimately null —
 * which would make harness gaps look like plugin bugs.
 *
 * @return int user ID
 */
function lab_login_admin( $login = 'labadmin' ) {
	$user = get_user_by( 'login', $login );
	if ( ! $user ) {
		return 0;
	}
	wp_set_current_user( $user->ID );
	return (int) $user->ID;
}

/** Uploads directory, created if the lab has not used it yet. */
function lab_uploads_dir() {
	$u = wp_get_upload_dir();
	if ( ! is_dir( $u['basedir'] ) ) {
		wp_mkdir_p( $u['basedir'] );
	}
	return $u['basedir'];
}
