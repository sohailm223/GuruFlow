/**
 * PHP-WASM runtime for the WordPress lab.
 *
 * Boots a real PHP interpreter (compiled to WebAssembly) with the host
 * filesystem mounted, so WordPress core, the SQLite driver and the ScanSite
 * collector plugin all execute as genuine PHP.
 *
 * Outbound HTTP works: php-wasm's cURL reaches the ScanSite dev server, so
 * wp_remote_post() from inside WordPress is a real request.
 */
import { PHP } from '@php-wasm/universal';
// `useHostFilesystem` is a php-wasm API, not a React hook — aliased so the
// react-hooks lint rule does not misread the `use` prefix.
import { loadNodeRuntime, useHostFilesystem as mountHostFilesystem } from '@php-wasm/node';

export const PHP_VERSION = process.env.LAB_PHP_VERSION || '8.3';

/**
 * Boot PHP and return a reusable instance.
 *
 * @param {string} [version] PHP version, e.g. '8.3'
 */
export async function boot(version = PHP_VERSION) {
  const php = new PHP(
    await loadNodeRuntime(version, { emscriptenOptions: { processId: 1 } })
  );
  mountHostFilesystem(php);
  return php;
}

/**
 * Run a PHP snippet and return { text, exitCode, errors }.
 *
 * @param {import('@php-wasm/universal').PHP} php
 * @param {string} code PHP source (must start with <?php)
 */
export async function run(php, code) {
  const res = await php.run({ code });
  const text = res.text ?? '';
  return { text, exitCode: res.exitCode, errors: res.errors ?? '' };
}

/**
 * Boot PHP with WordPress already loaded. The bootstrap requires
 * tests/wordpress-lab/wp/wp-load.php, which in turn loads the collector plugin
 * exactly as a normal WordPress request would.
 *
 * @param {object} options
 * @param {string} [options.labDir] absolute path to the lab directory
 * @param {boolean} [options.installing] set WP_INSTALLING
 */
export async function bootWordPress({ labDir, installing = false } = {}) {
  const php = await boot();
  const preamble = `<?php
if ( ${installing ? 'true' : 'false'} ) { define( 'WP_INSTALLING', true ); }
$_SERVER['HTTP_HOST']   = 'wp.local';
$_SERVER['REMOTE_ADDR'] = '203.0.113.9';
$_SERVER['REQUEST_URI'] = '/wp-admin/';
$_SERVER['SERVER_NAME'] = 'wp.local';
require '${labDir}/wp/wp-load.php';
`;
  const res = await php.run({ code: preamble + "?>\n" });
  if (res.exitCode !== 0) {
    throw new Error(`WordPress bootstrap failed: ${res.text} ${res.errors}`);
  }
  return php;
}

/**
 * Run a PHP body (without the opening tag) inside an already-booted WordPress.
 * The body is appended after a require of wp-load.php.
 *
 * @param {import('@php-wasm/universal').PHP} php
 * @param {string} body PHP statements, no opening <?php tag
 * @param {object} options
 * @param {string} options.labDir
 * @param {boolean} [options.installing] set WP_INSTALLING
 * @param {boolean} [options.admin] define WP_ADMIN so is_admin() is true and the
 *   plugin registers its admin screen, exactly as a wp-admin request does
 */
export async function wp(php, body, { labDir, installing = false, admin = false }) {
  const code = `<?php
if ( ${installing ? 'true' : 'false'} ) { define( 'WP_INSTALLING', true ); }
if ( ${admin ? 'true' : 'false'} ) { define( 'WP_ADMIN', true ); }
$_SERVER['HTTP_HOST']   = 'wp.local';
$_SERVER['REMOTE_ADDR'] = '203.0.113.9';
$_SERVER['REQUEST_URI'] = '/wp-admin/';
$_SERVER['SERVER_NAME'] = 'wp.local';
require '${labDir}/wp/wp-load.php';
require '${labDir}/php/helpers.php';
${body}
?>`;
  return run(php, code);
}
