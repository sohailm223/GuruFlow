<?php
/**
 * Plugin Name:       ScanSite Black Box Collector
 * Plugin URI:        https://scansite.example/blackbox
 * Description:       Sends important WordPress change and security events to your ScanSite Black Box dashboard so you can see exactly what happened to your website.
 * Version:           0.2.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            ScanSite
 * License:           GPL-2.0-or-later
 * Text Domain:       scansite-blackbox
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'SCANSITE_BB_VERSION', '0.2.0' );
define( 'SCANSITE_BB_FILE', __FILE__ );
define( 'SCANSITE_BB_DIR', plugin_dir_path( __FILE__ ) );

require_once SCANSITE_BB_DIR . 'includes/class-signing.php';
require_once SCANSITE_BB_DIR . 'includes/class-connection.php';
require_once SCANSITE_BB_DIR . 'includes/class-code-scanner.php';
require_once SCANSITE_BB_DIR . 'includes/class-file-integrity.php';
require_once SCANSITE_BB_DIR . 'includes/class-events.php';
require_once SCANSITE_BB_DIR . 'includes/class-collector.php';
require_once SCANSITE_BB_DIR . 'includes/class-heartbeat.php';
require_once SCANSITE_BB_DIR . 'includes/class-diagnostics.php';
require_once SCANSITE_BB_DIR . 'includes/class-admin.php';

/**
 * Boot the collector.
 *
 * Nothing here makes a blocking network request: events are queued to
 * wp_options and delivered by WP-Cron, so page loads and wp-admin actions are
 * never slowed down by ScanSite.
 */
function scansite_blackbox_init() {
	ScanSite_BB_Collector::instance()->boot();
	ScanSite_BB_Heartbeat::instance()->boot();

	if ( is_admin() ) {
		ScanSite_BB_Admin::instance()->boot();
	}
}
add_action( 'plugins_loaded', 'scansite_blackbox_init' );

register_activation_hook( __FILE__, array( 'ScanSite_BB_Collector', 'activate' ) );
register_deactivation_hook( __FILE__, array( 'ScanSite_BB_Collector', 'deactivate' ) );
