/**
 * Prepare a real, disposable WordPress installation for collector validation.
 *
 *   node setup.mjs [--reset] [--plugin-only]
 *
 * What it builds:
 *   wp/                          WordPress 6.8.3 core (downloaded from GitHub)
 *   wp/wp-content/db.php         SQLite drop-in (no MySQL server in this sandbox)
 *   wp/wp-content/plugins/scansite-blackbox-collector/
 *                                The REAL plugin, copied from wordpress-plugin/
 *
 * The plugin is re-copied on every run so the lab always tests current source.
 */
import { mkdirSync, cpSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { boot, wp } from './runtime.mjs';

const LAB = dirname(fileURLToPath(import.meta.url));
const REPO = join(LAB, '..', '..');
const WP = join(LAB, 'wp');
const SQLITE_SRC = join(LAB, 'wp-sqlite');
const PLUGIN_SRC = join(REPO, 'wordpress-plugin', 'scansite-blackbox-collector');
const PLUGIN_DST = join(WP, 'wp-content', 'plugins', 'scansite-blackbox-collector');
const SQLITE_DST = join(WP, 'wp-content', 'plugins', 'sqlite-database-integration');

const WP_TAG = '6.8.3';
const log = (...a) => console.log(...a);

const args = process.argv.slice(2);
const RESET = args.includes('--reset');

function download(url, dest) {
  log(`  downloading ${url}`);
  execSync(`curl -sL --fail -o "${dest}" "${url}"`, { stdio: 'inherit' });
}

/* ------------------------------------------------------------ WordPress */
if (!existsSync(join(WP, 'wp-load.php'))) {
  log(`WordPress core not present — fetching ${WP_TAG}`);
  const tar = join(LAB, '.wp.tar.gz');
  download(`https://codeload.github.com/WordPress/WordPress/tar.gz/refs/tags/${WP_TAG}`, tar);
  mkdirSync(WP, { recursive: true });
  execSync(`tar -xzf "${tar}" -C "${WP}" --strip-components=1`);
  rmSync(tar);
}
log(`WordPress core: ${join(WP, 'wp-load.php')} present=${existsSync(join(WP, 'wp-load.php'))}`);

/* ------------------------------------------------------------- SQLite */
if (!existsSync(SQLITE_SRC)) {
  throw new Error('SQLite driver missing — run: curl -sL -o s.tgz https://codeload.github.com/WordPress/sqlite-database-integration/tar.gz/refs/heads/main && mkdir wp-sqlite && tar -xzf s.tgz -C wp-sqlite --strip-components=1');
}
rmSync(SQLITE_DST, { recursive: true, force: true });
cpSync(SQLITE_SRC, SQLITE_DST, { recursive: true });
rmSync(join(SQLITE_DST, 'tests'), { recursive: true, force: true });
writeFileSync(
  join(WP, 'wp-content', 'db.php'),
  `<?php
define( 'SQLITE_DB_DROPIN_VERSION', '1.8.0' );
define( 'DATABASE_TYPE', 'sqlite' );
define( 'DB_ENGINE', 'sqlite' );
require_once '${SQLITE_DST}/wp-includes/sqlite/db.php';
`
);
log('SQLite drop-in installed');

/* ------------------------------------------------------------- config */
if (RESET) {
  rmSync(join(WP, 'wp-content', 'database'), { recursive: true, force: true });
}
mkdirSync(join(WP, 'wp-content', 'database'), { recursive: true });
mkdirSync(join(WP, 'wp-content', 'uploads'), { recursive: true });

writeFileSync(
  join(WP, 'wp-config.php'),
  `<?php
define( 'DB_NAME', 'scansite_lab' );
define( 'DB_USER', 'lab' );
define( 'DB_PASSWORD', 'lab' );
define( 'DB_HOST', 'localhost' );
define( 'DB_CHARSET', 'utf8mb4' );
define( 'DB_COLLATE', '' );
define( 'DB_DIR', __DIR__ . '/wp-content/database' );
define( 'DB_FILE', 'lab.sqlite' );

$table_prefix = 'wp_';

define( 'AUTH_KEY', 'lab-salt-auth-key-0001' );
define( 'SECURE_AUTH_KEY', 'lab-salt-secure-auth-key-0002' );
define( 'LOGGED_IN_KEY', 'lab-salt-logged-in-key-0003' );
define( 'NONCE_KEY', 'lab-salt-nonce-key-0004' );
define( 'AUTH_SALT', 'lab-salt-auth-salt-0005' );
define( 'SECURE_AUTH_SALT', 'lab-salt-secure-auth-salt-0006' );
define( 'LOGGED_IN_SALT', 'lab-salt-logged-in-salt-0007' );
define( 'NONCE_SALT', 'lab-salt-nonce-salt-0008' );

define( 'WP_DEBUG', true );
define( 'WP_DEBUG_LOG', __DIR__ . '/wp-content/php-error.log' );
define( 'WP_DEBUG_DISPLAY', false );
define( 'WP_ENVIRONMENT_TYPE', 'local' );
define( 'FS_METHOD', 'direct' );

if ( ! defined( 'ABSPATH' ) ) {
	define( 'ABSPATH', __DIR__ . '/' );
}
require_once ABSPATH . 'wp-settings.php';
`
);
log('wp-config.php written (SQLite, FS_METHOD=direct)');

/* ------------------------------------------------------------- plugin */
rmSync(PLUGIN_DST, { recursive: true, force: true });
cpSync(PLUGIN_SRC, PLUGIN_DST, { recursive: true });
const pluginFiles = readdirSync(join(PLUGIN_DST, 'includes')).map((f) => `includes/${f}`);
log(`Collector plugin copied (${1 + pluginFiles.length} files): ${PLUGIN_SRC}`);

/* ------------------------------------------------------------- install */
const php = await boot();
const check = await wp(
  php,
  `echo 'PHP=', PHP_VERSION, ' WP=', $GLOBALS['wp_version'], ' sqlite=', (defined('DB_ENGINE') ? DB_ENGINE : 'none'), "\\n";`,
  { labDir: LAB }
);
log(`bootstrap: ${check.text.trim()}${check.errors ? ' ERRORS: ' + check.errors : ''}`);

const installed = await wp(
  php,
  `
$is_installed = is_blog_installed();
echo 'is_blog_installed=', $is_installed ? 'yes' : 'no', "\\n";
if ( ! $is_installed ) {
	require_once ABSPATH . 'wp-admin/includes/upgrade.php';
	wp_install( 'ScanSite Lab', 'labadmin', 'admin@wp.local', true, '', 'LabPass!2345' );
	echo 'installed=', is_blog_installed() ? 'yes' : 'no', "\\n";
}
require_once ABSPATH . 'wp-admin/includes/plugin.php';
$res = activate_plugin( 'scansite-blackbox-collector/scansite-blackbox-collector.php', '', false, true );
echo 'activate_plugin=', is_wp_error( $res ) ? ('WP_Error: ' . $res->get_error_message()) : 'ok', "\\n";
$plugins = get_option( 'active_plugins', array() );
echo 'active_plugins=', wp_json_encode( $plugins ), "\\n";
echo 'collector_class=', class_exists( 'ScanSite_BB_Events' ) ? 'loaded' : 'MISSING', "\\n";
echo 'collector_version=', defined( 'SCANSITE_BB_VERSION' ) ? SCANSITE_BB_VERSION : 'none', "\\n";
`,
  { labDir: LAB, installing: true }
);
log(installed.text);
if (installed.errors) log('PHP errors:', installed.errors);

process.exit(0);
