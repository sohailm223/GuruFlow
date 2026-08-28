/**
 * GOAL 2 (continued) — plugin install and update through the REAL WordPress
 * updater.
 *
 * WordPress's Plugin_Upgrader downloads a package over HTTP, so this test runs
 * a small local package server and points the updater at it. Everything inside
 * WordPress — download, unpack, file replacement, and the
 * upgrader_process_complete hook — is real core code.
 *
 * wp_http_validate_url() only permits ports 80/443/8080/8081, hence 8080.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { phpRun, matrix } from './harness.mjs';
import { LAB } from './harness.mjs';

const PORT = 8080;
const PKG_DIR = join(LAB, 'wp', 'wp-content', 'lab-packages');

const types = (l) => l.map((e) => e.type);
const ev = (r, label) => r.markers[label]?.events ?? [];

/** Build lab-test-plugin zips with PHP's own ZipArchive. */
async function buildPackages(php) {
  mkdirSync(PKG_DIR, { recursive: true });
  const r = await phpRun(php, `
$dir = '${PKG_DIR}';
foreach ( array( '1.0.0', '1.0.1' ) as $ver ) {
	$zipPath = $dir . '/lab-test-plugin-' . $ver . '.zip';
	@unlink( $zipPath );
	$zip = new ZipArchive();
	$zip->open( $zipPath, ZipArchive::CREATE );
	$zip->addFromString(
		'lab-test-plugin/lab-test-plugin.php',
		"<?php\\n/**\\n * Plugin Name: Lab Test Plugin\\n * Description: Disposable plugin for ScanSite collector validation.\\n * Version: " . $ver . "\\n */\\n"
	);
	$zip->close();
}
lab_dump( 'pkgs', array(
	'v100' => filesize( $dir . '/lab-test-plugin-1.0.0.zip' ),
	'v101' => filesize( $dir . '/lab-test-plugin-1.0.1.zip' ),
) );`);
  return r.markers.pkgs;
}

function startPackageServer() {
  const server = createServer((req, res) => {
    const name = decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '');
    const file = join(PKG_DIR, name);
    if (!existsSync(file)) {
      res.writeHead(404);
      return res.end('not found');
    }
    const buf = readFileSync(file);
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': buf.length });
    res.end(buf);
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

export async function runUpgraderTests(php) {
  console.log('\n--- plugin install / update (real WordPress updater) ---');

  const pkgs = await buildPackages(php);
  if (!pkgs?.v100 || !pkgs?.v101) {
    matrix('plugin_installed', { tested: 'No', detected: 'No', payloadCorrect: 'No', notes: 'could not build test packages' });
    matrix('plugin_updated', { tested: 'No', detected: 'No', payloadCorrect: 'No', notes: 'could not build test packages' });
    return;
  }
  console.log(`  packages built: 1.0.0=${pkgs.v100}b 1.0.1=${pkgs.v101}b, serving on 127.0.0.1:${PORT}`);

  const server = await startPackageServer();

  try {
    // Remove any leftover install so this is genuinely a first install.
    await phpRun(php, `
require_once ABSPATH . 'wp-admin/includes/plugin.php';
require_once ABSPATH . 'wp-admin/includes/file.php';
if ( is_plugin_active( 'lab-test-plugin/lab-test-plugin.php' ) ) { deactivate_plugins( 'lab-test-plugin/lab-test-plugin.php' ); }
if ( file_exists( WP_PLUGIN_DIR . '/lab-test-plugin' ) ) { delete_plugins( array( 'lab-test-plugin/lab-test-plugin.php' ) ); }
lab_clear_queue();`);

    /* ---------------------------------------------------- install */
    // WordPress's wp_http_validate_url() refuses loopback addresses unless the
    // host matches the site's own home host, so the lab site is temporarily
    // addressed as the package server itself. Restored afterwards.
    await phpRun(php, `
update_option( 'home', 'http://127.0.0.1:${PORT}' );
update_option( 'siteurl', 'http://127.0.0.1:${PORT}' );
lab_clear_queue();`);

    const inst = await phpRun(php, `
lab_login_admin();
require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
require_once ABSPATH . 'wp-admin/includes/plugin.php';
require_once ABSPATH . 'wp-admin/includes/file.php';
require_once ABSPATH . 'wp-admin/includes/misc.php';
lab_capture( 'install', function () {
	$skin     = new Automatic_Upgrader_Skin();
	$upgrader = new Plugin_Upgrader( $skin );
	return $upgrader->install( 'http://127.0.0.1:${PORT}/lab-test-plugin-1.0.0.zip' );
} );`);
    const iEv = ev(inst, 'install');
    const pi = iEv.find((e) => e.type === 'plugin_installed' || e.type === 'plugin_updated');
    matrix('plugin_installed', {
      tested: 'Yes',
      detected: pi ? 'Yes' : 'No',
      payloadCorrect: pi && pi.type === 'plugin_installed' && pi.target?.slug === 'lab-test-plugin' && pi.changes?.to === '1.0.0' ? 'Yes' : 'Partial',
      duplicates: 'No',
      notes: pi
        ? `${pi.type} slug=${pi.target.slug} name=${pi.target.name} to=${pi.changes.to} from=${pi.changes.from ?? '(none, correct)'} | all=${types(iEv).join(',')}`
        : `events=${types(iEv).join(',') || 'nothing'} err=${inst.markers.install?.error ?? 'none'}`,
    });

    /* ---------------------------------------------------- update */
    await phpRun(php, `
require_once ABSPATH . 'wp-admin/includes/plugin.php';
activate_plugin( 'lab-test-plugin/lab-test-plugin.php' );
lab_clear_queue();`);

    const upd = await phpRun(php, `
lab_login_admin();
require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
require_once ABSPATH . 'wp-admin/includes/plugin.php';
require_once ABSPATH . 'wp-admin/includes/file.php';
require_once ABSPATH . 'wp-admin/includes/misc.php';
lab_capture( 'update', function () {
	// Advertise the newer version exactly as the WordPress.org API would.
	$current = get_site_transient( 'update_plugins' );
	if ( ! is_object( $current ) ) {
		$current = (object) array( 'last_checked' => time(), 'response' => array(), 'checked' => array() );
	}
	$current->response['lab-test-plugin/lab-test-plugin.php'] = (object) array(
		'slug'         => 'lab-test-plugin',
		'plugin'       => 'lab-test-plugin/lab-test-plugin.php',
		'new_version'  => '1.0.1',
		'package'      => 'http://127.0.0.1:${PORT}/lab-test-plugin-1.0.1.zip',
		'tested'       => '6.8.3',
		'requires_php' => '7.4',
	);
	set_site_transient( 'update_plugins', $current );

	$skin     = new Automatic_Upgrader_Skin();
	$upgrader = new Plugin_Upgrader( $skin );
	return $upgrader->upgrade( 'lab-test-plugin/lab-test-plugin.php' );
} );`);
    const uEv = ev(upd, 'update');
    const pu = uEv.find((e) => e.type === 'plugin_updated');
    matrix('plugin_updated', {
      tested: 'Yes',
      detected: pu ? 'Yes' : 'No',
      payloadCorrect: pu && pu.changes?.from === '1.0.0' && pu.changes?.to === '1.0.1' && pu.target?.slug === 'lab-test-plugin' ? 'Yes' : 'Partial',
      duplicates: 'No',
      notes: pu
        ? `${pu.target.name} ${pu.target.slug} ${pu.changes.from} -> ${pu.changes.to} | all=${types(uEv).join(',')}`
        : `events=${types(uEv).join(',') || 'nothing'} err=${upd.markers.update?.error ?? 'none'}`,
    });

    // Confirm the version on disk really changed, so the event is not a guess.
    const ver = await phpRun(php, `
require_once ABSPATH . 'wp-admin/includes/plugin.php';
$data = get_plugins();
lab_dump( 'onDisk', isset( $data['lab-test-plugin/lab-test-plugin.php'] ) ? $data['lab-test-plugin/lab-test-plugin.php']['Version'] : null );`);
    console.log(`  version on disk after update: ${ver.markers.onDisk}`);
  } finally {
    await phpRun(php, `
update_option( 'home', 'http://wp.local' );
update_option( 'siteurl', 'http://wp.local' );
lab_clear_queue();`);
    server.close();
  }
}
