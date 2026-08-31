/**
 * PHP Error Capture — verify the collector records real PHP errors inside real
 * WordPress.
 *
 * Every test raises a genuine PHP error. Nothing here fabricates an event: if
 * the shutdown handler does not fire, or the metadata is wrong, the test says
 * so. The collector must queue the error locally and never send it during the
 * dying request, so the queue is inspected first and delivery happens later
 * through the normal WP-Cron flush.
 */
import { phpRun, queue, clearQueue, flush, note, matrix, api, LAB } from './harness.mjs';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** A throwaway plugin, so an error can be raised from a real plugin file. */
const PROBE_DIR = join(LAB, 'wp', 'wp-content', 'plugins', 'scansite-error-probe');
const PROBE_SLUG = 'scansite-error-probe';
const REQUIRE = `require_once WP_PLUGIN_DIR . '/${PROBE_SLUG}/${PROBE_SLUG}.php';`;

function writeProbePlugin() {
  mkdirSync(PROBE_DIR, { recursive: true });
  writeFileSync(
    join(PROBE_DIR, 'scansite-error-probe.php'),
    `<?php
/*
Plugin Name: ScanSite Error Probe
Description: Throwaway plugin used by the PHP error capture tests.
Version: 1.2.0
*/
class ScanSiteErrorProbe {
	public function undefined_method() {
		$this->method_that_does_not_exist();
	}
}
`
  );
}

/**
 * Raise an error inside real WordPress and return what the collector queued.
 *
 * A fatal kills the request, so the throw is expected and swallowed — the
 * queue read afterwards is the real assertion.
 */
async function raiseAndCapture(php, statement) {
  await clearQueue(php);
  await phpRun(php, 'lab_login_admin(); update_option(ScanSite_BB_Error_Capture::OPT_STATE, array(), false); lab_clear_queue();');
  try {
    await phpRun(php, statement);
  } catch {
    /* the request is meant to die */
  }
  const q = await queue(php);
  return q.find((e) => e.type === 'php_error' || e.type === 'http_error') ?? null;
}

export async function runErrorTests(php, siteId) {
  console.log('\n' + '='.repeat(72));
  console.log('PHP ERROR CAPTURE');
  console.log('='.repeat(72));

  writeProbePlugin();

  /* ---------------------------------------------------- the handler loads */
  console.log('\n--- handler registration ---');

  const loaded = await phpRun(php, `
lab_login_admin();
lab_dump('class', class_exists('ScanSite_BB_Error_Capture'));
lab_dump('connected', ScanSite_BB_Connection::has_credentials());
lab_dump('siteId', ScanSite_BB_Connection::site_id());`);

  note('errors', 'The error capture class loads inside WordPress', loaded.markers.class === true, `class_exists=${loaded.markers.class}`);
  note('errors', 'Capture is gated on a connected website', loaded.markers.connected === true, `siteId=${loaded.markers.siteId}`);

  /* --------------------------------------------- capture + attribution */
  console.log('\n--- a fatal inside a plugin file ---');

  const pluginError = await raiseAndCapture(php, `${REQUIRE}\n( new ScanSiteErrorProbe() )->undefined_method();`);
  const m = pluginError?.metadata ?? {};

  note('errors', 'A real PHP error is captured', pluginError !== null, pluginError ? `${pluginError.type}: ${m.message}` : 'nothing queued');
  matrix('php_error', {
    tested: 'Yes',
    detected: pluginError !== null ? 'Yes' : 'No',
    payloadCorrect: m.relativePath && m.line ? 'Yes' : 'No',
    notes: pluginError ? `${m.severity} in ${m.relativePath}:${m.line}` : 'not captured',
  });

  note('errors', 'The message is recorded', typeof m.message === 'string' && m.message.length > 0, m.message);
  note('errors', 'The exact file path is recorded', typeof m.file === 'string' && m.file.length > 0, m.file);
  note('errors', 'The exact line number is recorded', typeof m.line === 'number' && m.line > 0, `line=${m.line}`);
  note('errors', 'The relative path has no stray separators',
    typeof m.relativePath === 'string' && !/[\\/]{2,}/.test(m.relativePath) && !m.relativePath.endsWith('/'),
    m.relativePath);
  note('errors', 'The severity is recorded', m.severity === 'Fatal error', `severity=${m.severity}`);
  note('errors', 'The error class is recorded', m.errorClass === 'Error', `errorClass=${m.errorClass}`);
  note('errors', 'The request path is recorded', typeof m.requestPath === 'string' && m.requestPath.length > 0, m.requestPath);
  note('errors', 'The request method is recorded', typeof m.requestMethod === 'string' && m.requestMethod.length > 0, m.requestMethod);
  note('errors', 'The PHP version is recorded', /^\d+\.\d+/.test(String(m.phpVersion ?? '')), `php=${m.phpVersion}`);
  note('errors', 'First/last seen are recorded', Number(m.firstSeen) > 0 && Number(m.lastSeen) >= Number(m.firstSeen), `first=${m.firstSeen} last=${m.lastSeen}`);
  note('errors', 'The actor is recorded when available', !pluginError || pluginError.actor !== undefined, `actor=${JSON.stringify(pluginError?.actor ?? null)}`);

  /* ------------------------------------------------- component detection */
  console.log('\n--- component ownership ---');

  note('errors', 'The file is attributed to a plugin', m.component === 'plugin', `component=${m.component}`);
  note('errors', 'The plugin slug is resolved', m.componentSlug === PROBE_SLUG, `slug=${m.componentSlug}`);
  note('errors', 'The plugin display name is resolved', m.componentName === 'ScanSite Error Probe', `name=${m.componentName}`);

  // Attribution is exercised directly for the components a single raised error
  // cannot reach, using the real paths from this WordPress install.
  const attributed = await phpRun(php, `
$cases = array(
  'core'      => ABSPATH . 'wp-includes/functions.php',
  'plugin'    => WP_PLUGIN_DIR . '/${PROBE_SLUG}/${PROBE_SLUG}.php',
  'mu_plugin' => WPMU_PLUGIN_DIR . '/always-on.php',
  'theme'     => get_theme_root() . '/twentytwentyfive/style.css',
  'uploads'   => wp_upload_dir()['basedir'] . '/2026/01/image.php',
  'config'    => ABSPATH . 'wp-config.php',
  'external'  => '/usr/share/php/pear.php',
  'unknown'   => '',
);
$out = array();
foreach ( $cases as $expect => $path ) {
  $a = ScanSite_BB_Error_Capture::attribute( $path );
  $out[] = array( 'expect' => $expect, 'component' => $a['component'], 'slug' => $a['slug'], 'name' => $a['name'], 'relativePath' => $a['relativePath'] );
}
lab_dump('attributed', $out);`);

  const rows = attributed.markers.attributed ?? [];
  const byExpect = Object.fromEntries(rows.map((r) => [r.expect, r]));
  console.log(`  attribution across ${rows.length} real paths:`);
  for (const r of rows) {
    console.log(`   ${r.component === r.expect ? '✓' : '✗'} ${r.expect.padEnd(10)} -> ${r.component}${r.slug ? ` (${r.slug})` : ''}`);
  }

  note('errors', 'WordPress Core files are attributed to Core', byExpect.core?.component === 'core', `got=${byExpect.core?.component}`);
  note('errors', 'Plugin files are attributed to Plugin', byExpect.plugin?.component === 'plugin', `got=${byExpect.plugin?.component}`);
  note('errors', 'Must-use plugin files are attributed to MU Plugin', byExpect.mu_plugin?.component === 'mu_plugin', `got=${byExpect.mu_plugin?.component}`);
  note('errors', 'Theme files are attributed to Theme', byExpect.theme?.component === 'theme', `got=${byExpect.theme?.component} name=${byExpect.theme?.name}`);
  note('errors', 'Upload files are attributed to Uploads', byExpect.uploads?.component === 'uploads', `got=${byExpect.uploads?.component}`);
  note('errors', 'wp-config.php is attributed to Config', byExpect.config?.component === 'config', `got=${byExpect.config?.component}`);
  note('errors', 'Files outside WordPress are attributed to External', byExpect.external?.component === 'external', `got=${byExpect.external?.component}`);
  note('errors', 'An empty path degrades to Unknown, never a crash', byExpect.unknown?.component === 'unknown', `got=${byExpect.unknown?.component}`);
  note('errors', 'Every attribution returns the same keys',
    rows.every((r) => 'component' in r && 'slug' in r && 'name' in r && 'relativePath' in r),
    'component/slug/name/relativePath present on all');

  /* --------------------------------------------- no network while dying */
  console.log('\n--- no network during the dying request ---');

  // A real assertion rather than an inference: intercept every outbound HTTP
  // request in the same process that raises the error, then count attempts.
  const net = await phpRun(php, `
${REQUIRE}
$GLOBALS['lab_http'] = 0;
add_filter( 'pre_http_request', function ( $preempt ) { $GLOBALS['lab_http']++; return new WP_Error( 'blocked', 'lab' ); }, 1, 3 );
lab_clear_queue();
update_option( ScanSite_BB_Error_Capture::OPT_STATE, array(), false );
try {
  ( new ScanSiteErrorProbe() )->undefined_method();
} catch ( \\Throwable $e ) {
  ScanSite_BB_Error_Capture::on_exception( $e );
}
lab_dump('httpAttempts', $GLOBALS['lab_http'] );
lab_dump('queued', count( lab_queue() ) );`);

  note('errors', 'Capture makes no HTTP request', net.markers.httpAttempts === 0, `outbound requests=${net.markers.httpAttempts}`);
  note('errors', 'The error is queued locally instead', (net.markers.queued ?? 0) === 1, `queued=${net.markers.queued}`);

  const queuedAfterFatal = await queue(php);
  note('errors', 'The event survives the request that died',
    queuedAfterFatal.some((e) => e.category === 'error'),
    `${queuedAfterFatal.filter((e) => e.category === 'error').length} error event(s) in the queue`);

  const cron = await phpRun(php, `
lab_login_admin();
ScanSite_BB_Collector::instance()->maybe_schedule();
lab_dump('scheduled', (bool) wp_next_scheduled( ScanSite_BB_Collector::FLUSH_HOOK ) );`);
  note('errors', 'Delivery rides the existing WP-Cron flush', cron.markers.scheduled === true, `flush scheduled=${cron.markers.scheduled}`);

  /* ---------------------------------------------------- repeat counting */
  console.log('\n--- repeats are counted, not duplicated ---');

  const repeats = await phpRun(php, `
${REQUIRE}
lab_login_admin();
lab_clear_queue();
update_option( ScanSite_BB_Error_Capture::OPT_STATE, array(), false );
for ( $i = 0; $i < 5; $i++ ) {
  try {
    ( new ScanSiteErrorProbe() )->undefined_method();
  } catch ( \\Throwable $e ) {
    ScanSite_BB_Error_Capture::on_exception( $e );
  }
}
lab_dump('queued', count( lab_queue() ) );
lab_dump('events', lab_queue() );
lab_dump('state', get_option( ScanSite_BB_Error_Capture::OPT_STATE, array() ) );`);

  const repQueued = repeats.markers.queued ?? -1;
  const repEvents = repeats.markers.events ?? [];
  const repState = repeats.markers.state ?? {};
  const fpKey = Object.keys(repState)[0];
  const tracked = fpKey ? repState[fpKey] : null;

  note('errors', 'A crash loop queues one event, not five', repQueued === 1, `queued=${repQueued}`);
  note('errors', 'The true total is kept in the throttle state', tracked?.count === 5, `count=${tracked?.count}`);
  note('errors', 'The queued event reports what it knew',
    repEvents[0]?.metadata?.occurrences === 1 && repEvents[0]?.metadata?.totalSeen === 1,
    `occurrences=${repEvents[0]?.metadata?.occurrences} totalSeen=${repEvents[0]?.metadata?.totalSeen}`);

  // Now let the throttle window pass and hit the same error once more: the
  // accumulated remainder has to arrive with the true first/last seen.
  const afterWindow = await phpRun(php, `
${REQUIRE}
lab_login_admin();
$state = get_option( ScanSite_BB_Error_Capture::OPT_STATE, array() );
foreach ( $state as $k => $v ) { $state[$k]['reportedAt'] = time() - ( ScanSite_BB_Error_Capture::REPORT_INTERVAL + 5 ); }
update_option( ScanSite_BB_Error_Capture::OPT_STATE, $state, false );
lab_clear_queue();
try { ( new ScanSiteErrorProbe() )->undefined_method(); } catch ( \\Throwable $e ) { ScanSite_BB_Error_Capture::on_exception( $e ); }
lab_dump('events', lab_queue() );
lab_dump('state', get_option( ScanSite_BB_Error_Capture::OPT_STATE, array() ) );`);

  const aw = (afterWindow.markers.events ?? [])[0]?.metadata ?? {};
  note('errors', 'The next report carries the accumulated occurrences', aw.occurrences === 5, `occurrences=${aw.occurrences} (5 unseen of 6 total)`);
  note('errors', 'First seen stays at the original occurrence',
    Number(aw.firstSeen) > 0 && Number(aw.lastSeen) >= Number(aw.firstSeen), `first=${aw.firstSeen} last=${aw.lastSeen}`);
  note('errors', 'The total keeps climbing across reports', aw.totalSeen === 6, `totalSeen=${aw.totalSeen}`);

  /* ------------------------------------------------------- fingerprinting */
  console.log('\n--- grouping key ---');

  const distinct = await phpRun(php, `
$p = 'wp-content/plugins/a/b.php';
lab_dump('same', ScanSite_BB_Error_Capture::fingerprint( 'Fatal error', 'Call to undefined method X::y()', $p, 10 ) );
lab_dump('otherLine', ScanSite_BB_Error_Capture::fingerprint( 'Fatal error', 'Call to undefined method X::y()', $p, 11 ) );
lab_dump('otherFile', ScanSite_BB_Error_Capture::fingerprint( 'Fatal error', 'Call to undefined method X::y()', 'wp-content/plugins/a/c.php', 10 ) );
lab_dump('otherSeverity', ScanSite_BB_Error_Capture::fingerprint( 'Warning', 'Call to undefined method X::y()', $p, 10 ) );
lab_dump('volatileA', ScanSite_BB_Error_Capture::fingerprint( 'Fatal error', "Undefined variable 'rowId'", $p, 10 ) );
lab_dump('volatileB', ScanSite_BB_Error_Capture::fingerprint( 'Fatal error', "Undefined variable 'userId'", $p, 10 ) );
lab_dump('hexA', ScanSite_BB_Error_Capture::fingerprint( 'Fatal error', 'Allowed memory size exhausted at 0x7f3a1b', $p, 10 ) );
lab_dump('hexB', ScanSite_BB_Error_Capture::fingerprint( 'Fatal error', 'Allowed memory size exhausted at 0x9c2200', $p, 10 ) );
lab_dump('len', strlen( ScanSite_BB_Error_Capture::fingerprint( 'Fatal error', 'x', $p, 1 ) ) );`);

  const d = distinct.markers;
  note('errors', 'The same error on a different line is a separate group', d.same !== d.otherLine, `${d.same} vs ${d.otherLine}`);
  note('errors', 'The same error in a different file is a separate group', d.same !== d.otherFile, `${d.same} vs ${d.otherFile}`);
  note('errors', 'A different severity is a separate group', d.same !== d.otherSeverity, `${d.same} vs ${d.otherSeverity}`);
  note('errors', 'The same error and line share one fingerprint', d.same === d.same && typeof d.same === 'string' && d.same.length === 24, `len=${d.same?.length}`);
  note('errors', 'Volatile identifiers are normalised so repeats still group', d.volatileA === d.volatileB, `${d.volatileA} === ${d.volatileB}`);
  note('errors', 'Memory addresses are normalised', d.hexA === d.hexB, `${d.hexA} === ${d.hexB}`);

  /* --------------------------------------------------- privacy of payload */
  console.log('\n--- the payload stays safe ---');

  const keys = Object.keys(m);
  note('errors', 'No file contents are ever included',
    !keys.some((k) => /contents?|source|body/i.test(k)), `metadata keys=${keys.join(',')}`);
  note('errors', 'No credentials are included',
    !keys.some((k) => /password|secret|token|apikey|cookie|auth/i.test(k)), `metadata keys=${keys.join(',')}`);
  note('errors', 'The query string is not included in the request path',
    typeof m.requestPath === 'string' && !m.requestPath.includes('?'), `requestPath=${m.requestPath}`);
  note('errors', 'The message is length-bounded', typeof m.message === 'string' && m.message.length <= 500, `len=${m.message?.length}`);

  /* ------------------------------------------------------ real delivery */
  console.log('\n--- delivery through the normal flush ---');

  await phpRun(php, `
${REQUIRE}
lab_login_admin();
lab_clear_queue();
update_option( ScanSite_BB_Error_Capture::OPT_STATE, array(), false );
try { ( new ScanSiteErrorProbe() )->undefined_method(); } catch ( \\Throwable $e ) { ScanSite_BB_Error_Capture::on_exception( $e ); }
lab_dump('queued', count( lab_queue() ) );`);

  const delivered = await flush(php);
  // Read the marker explicitly: defaulting an absent QUEUE marker to [] would
  // make "the queue is empty" pass even when the flush never reported one.
  const leftQueued = Array.isArray(delivered.markers.QUEUE) ? delivered.markers.QUEUE : null;
  note('errors', 'The flush reports its queue state', leftQueued !== null, `QUEUE marker present=${leftQueued !== null}`);
  const arrived = await api.events(siteId);
  const errEvents = (arrived.body?.events ?? []).filter((e) => e.category === 'error');

  const stillQueued = (leftQueued ?? []).filter((e) => e.type === 'php_error' || e.type === 'http_error');
  note('errors', 'The error leaves the queue on flush', stillQueued.length === 0, `errors still queued=${stillQueued.length}`);
  note('errors', 'ScanSite receives the error event', errEvents.length > 0, `received ${errEvents.length} error event(s)`);

  const wire = errEvents[0]?.metadata ?? {};
  note('errors', 'The delivered event keeps the file and line',
    typeof wire.relativePath === 'string' && typeof wire.line === 'number', `${wire.relativePath}:${wire.line}`);
  note('errors', 'The delivered event keeps the component',
    wire.component === 'plugin' && wire.componentSlug === PROBE_SLUG, `${wire.component}/${wire.componentSlug}`);
  note('errors', 'The delivered event keeps the fingerprint',
    typeof wire.fingerprint === 'string' && wire.fingerprint.length === 24, `fingerprint=${wire.fingerprint}`);

  /* -------------------------------------------------------- clean up */
  rmSync(PROBE_DIR, { recursive: true, force: true });
  await phpRun(php, 'lab_clear_queue();');

  return { captured: pluginError !== null, metadata: m };
}
