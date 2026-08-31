/**
 * GOAL 3 + reliability — collector diagnostics, queue behaviour, offline
 * delivery, batching, performance and a payload privacy audit.
 *
 * Everything runs inside real WordPress.
 */
import { phpRun, queue, clearQueue, flush, note, matrix, results, api, WP_ENDPOINT } from './harness.mjs';

const types = (l) => l.map((e) => e.type);

export async function runCollectorTests(php, siteId) {
  console.log('\n' + '='.repeat(72));
  console.log('GOAL 3 — COLLECTOR DIAGNOSTICS + RELIABILITY');
  console.log('='.repeat(72));

  /* --------------------------------------------------- diagnostics */
  console.log('\n--- diagnostics ---');

  const diag = await phpRun(php, `
lab_login_admin();
lab_dump('checks', ScanSite_BB_Diagnostics::run() );
lab_dump('status', ScanSite_BB_Diagnostics::status() );`, { admin: true });

  const checks = diag.markers.checks || [];
  const status = diag.markers.status || {};
  const byId = Object.fromEntries(checks.map((c) => [c.id, c]));
  console.log(`  ${checks.length} checks returned:`);
  for (const c of checks) {
    const icon = c.status === 'pass' ? '✓' : c.status === 'warn' ? '!' : '✗';
    console.log(`   ${icon} ${c.label.padEnd(26)} ${c.message}`);
  }

  note('queue', 'Diagnostics runs inside WordPress', checks.length >= 10, `${checks.length} checks`);
  note('queue', 'Diagnostics reports config/credentials', byId.config?.status === 'pass' && byId.key?.status === 'pass', `config=${byId.config?.status} key=${byId.key?.status}`);
  note('queue', 'Diagnostics reports network reachability', byId.reachable?.status === 'pass', byId.reachable?.message);
  note('queue', 'Diagnostics reports auth + ingest', byId.auth?.status === 'pass' && byId.ingest?.status === 'pass', `auth=${byId.auth?.status} ingest=${byId.ingest?.status}`);
  note('queue', 'Diagnostics reports cron + queue + files', byId.cron?.status && byId.queue?.status === 'pass' && byId.file_monitor?.status === 'pass', `cron=${byId.cron?.status} queue=${byId.queue?.status} files=${byId.file_monitor?.status}`);
  note('queue', 'Diagnostics status header has no secret', !JSON.stringify(status).includes('sk_bb_'), `keys=${Object.keys(status).join(',')}`);
  note('queue', 'Status header exposes the required fields',
    !!status.endpoint && !!status.siteId && !!status.collectorVersion && !!status.wordpressVersion && !!status.phpVersion && status.signingMode !== undefined,
    `collector=${status.collectorVersion} wp=${status.wordpressVersion} php=${status.phpVersion} signing=${status.signingMode}`);

  /* ---------------------------------------------- send test event */
  await clearQueue(php);
  const test = await phpRun(php, `
lab_login_admin();
lab_dump('sent', ScanSite_BB_Collector::instance()->send_test_event() === true ? 'true' : 'false' );
lab_dump('queueAfter', ScanSite_BB_Events::queue_size() );`, { admin: true });
  const scanEvents = await api.events(siteId);
  const gotTest = (scanEvents.body.events || []).some((e) => e.type === 'collector_test');
  note('queue', 'Send Test Event works through the real pipeline', test.markers.sent === 'true' && test.markers.queueAfter === 0, `delivered=${test.markers.sent} queueAfter=${test.markers.queueAfter} scanSiteReceived=${gotTest}`);

  /* ---------------------------------------------- admin screen html */
  const html = await phpRun(php, `
lab_login_admin();
do_action( 'admin_post_scansite_blackbox_diagnostics' );
`, { admin: true }).catch(() => null);

  const screen = await phpRun(php, `
lab_admin_context();   // loads wp-admin/includes/admin.php, as a real admin page does
ob_start();
ScanSite_BB_Admin::instance()->render();
$html = ob_get_clean();
lab_dump('has', array(
  'diagnostics' => false !== strpos( $html, 'Collector Diagnostics' ),
  'sendTest'    => false !== strpos( $html, 'Send Test Event' ),
  'runDiag'     => false !== strpos( $html, 'Run Diagnostics' ),
  'retry'       => false !== strpos( $html, 'Retry Delivery' ),
  'queue'       => false !== strpos( $html, 'Queued events' ),
  'signing'     => false !== strpos( $html, 'Signing mode' ),
  'lastError'   => false !== strpos( $html, 'Last delivery error' ),
  'secret'      => false !== strpos( $html, ScanSite_BB_Connection::collector_key() ),
  'formInP'     => (bool) preg_match( '/<p>\\s*<form/i', $html ),
  'hero'        => false !== strpos( $html, 'scansite-bb-hero' ),
  'pill'        => false !== strpos( $html, 'scansite-bb-pill--' ),
  // Count rendered tiles, not the CSS rules that mention the same class.
  'tiles'       => preg_match_all( '/<div class="scansite-bb-stat__v">/', $html ),
  'styles'      => false !== strpos( $html, 'scansite-bb-hero{' ),
) );`, { admin: true });
  const has = screen.markers.has || {};
  note('queue', 'Admin screen shows diagnostics UI', has.diagnostics && has.runDiag && has.sendTest && has.retry, `diagnostics=${has.diagnostics} runDiag=${has.runDiag} sendTest=${has.sendTest} retry=${has.retry}`);
  note('queue', 'Admin screen shows queue, signing, last error', has.queue && has.signing && has.lastError, `queue=${has.queue} signing=${has.signing} lastError=${has.lastError}`);
  note('queue', 'Admin screen never prints the secret', has.secret === false, `secretPresent=${has.secret}`);
  note('queue', 'No <form> nested inside <p>', has.formInP === false, `formInP=${has.formInP}`);
  note('queue', 'Status panel renders with styles, pill and 4 tiles', has.hero && has.styles && has.pill && has.tiles === 4, `hero=${has.hero} styles=${has.styles} pill=${has.pill} tiles=${has.tiles}`);

  /* ------------------------------------------- queue limit policy */
  console.log('\n--- queue limit ---');
  const limit = await phpRun(php, `
lab_clear_queue();
$e = new ScanSite_BB_Events();
for ( $i = 0; $i < 1005; $i++ ) {
	$e->enqueue( 'collector_test', 'core', array( 'metadata' => array( 'i' => $i ) ) );
}
$q = get_option( ScanSite_BB_Events::OPT_QUEUE, array() );
lab_dump('limit', array(
  'size'    => count( $q ),
  'max'     => ScanSite_BB_Events::MAX_QUEUE,
  'firstI'  => $q[0]['metadata']['i'],
  'lastI'   => $q[ count( $q ) - 1 ]['metadata']['i'],
) );`);
  const lim = limit.markers.limit || {};
  note('queue', 'Queue is capped at MAX_QUEUE', lim.size === lim.max, `size=${lim.size} max=${lim.max}`);
  note('queue', 'Oldest events are dropped, newest kept', lim.firstI === 5 && lim.lastI === 1004, `first=${lim.firstI} last=${lim.lastI} (policy: keep newest)`);
  await clearQueue(php);

  /* ------------------------------------------- offline delivery */
  console.log('\n--- offline delivery ---');
  const offline = await phpRun(php, `
lab_login_admin();
// Point the collector at an endpoint that cannot answer.
$real = ScanSite_BB_Connection::endpoint();
update_option( ScanSite_BB_Connection::OPT_ENDPOINT, 'http://127.0.0.1:9' );
lab_clear_queue();
$e = new ScanSite_BB_Events();
for ( $i = 0; $i < 5; $i++ ) { $e->enqueue( 'plugin_activated', 'plugin', array( 'metadata' => array( 'i' => $i, 'labTag' => 'offline' ) ) ); }
lab_flush();
lab_dump('offline', array(
  'queued'   => ScanSite_BB_Events::queue_size(),
  'attempts' => (int) get_option( ScanSite_BB_Collector::OPT_ATTEMPTS, 0 ),
  'state'    => ScanSite_BB_Connection::state(),
  'error'    => ScanSite_BB_Connection::last_error(),
) );
// Restore and deliver.
update_option( ScanSite_BB_Connection::OPT_ENDPOINT, $real );
lab_flush();
lab_dump('restored', array(
  'queued'   => ScanSite_BB_Events::queue_size(),
  'attempts' => (int) get_option( ScanSite_BB_Collector::OPT_ATTEMPTS, 0 ),
  'state'    => ScanSite_BB_Connection::state(),
) );`);
  const off = offline.markers.offline || {};
  const rest = offline.markers.restored || {};
  note('queue', 'Events stay queued while ScanSite is unreachable', off.queued === 5, `queued=${off.queued}`);
  note('queue', 'Retry counter increments on failure', off.attempts === 1, `attempts=${off.attempts}`);
  note('queue', 'Offline failure produces a readable message', !!off.error && !/stack trace|Fatal/i.test(off.error), off.error);
  // Regression: a failed delivery must not permanently disable the collector.
  // flush() used to gate on the last-known state, so one outage left the queue
  // stuck forever even after ScanSite came back.
  note('queue', 'Delivery resumes automatically after an outage', rest.queued === 0 && rest.state === 'connected', `queued=${rest.queued} state=${rest.state}`);

  const deliveredOffline = await api.events(siteId);
  const offlineCount = (deliveredOffline.body.events || []).filter((e) => e.type === 'plugin_activated').length;
  note('queue', 'No events lost across the outage', offlineCount === 5, `ScanSite received ${offlineCount}/5`);

  /* ------------------------------------------- batching */
  console.log('\n--- batching ---');
  await clearQueue(php);
  const batch = await phpRun(php, `
lab_login_admin();
$e = new ScanSite_BB_Events();
for ( $i = 0; $i < 73; $i++ ) { $e->enqueue( 'cron_added', 'cron', array( 'metadata' => array( 'i' => $i, 'labTag' => 'batch' ) ) ); }
lab_dump('before', ScanSite_BB_Events::queue_size() );
lab_flush();
lab_dump('afterOneFlush', ScanSite_BB_Events::queue_size() );
lab_flush();
lab_dump('afterTwoFlush', ScanSite_BB_Events::queue_size() );
lab_dump('maxBatch', ScanSite_BB_Events::MAX_BATCH );`);
  const b0 = batch.markers.before, b1 = batch.markers.afterOneFlush, b2 = batch.markers.afterTwoFlush, mb = batch.markers.maxBatch;
  note('queue', 'Batch size is respected', b0 === 73 && b1 === 73 - mb, `queued=${b0} after 1 flush=${b1} (batch=${mb})`);
  // 73 queued, batch of 50: the first flush clears 50 and leaves 23, the
  // second clears the remainder.
  note('queue', 'Remaining events deliver on the next run', b1 === 73 - mb && b2 === 0, `after 1 flush=${b1} (batch ${mb}), after 2=${b2}`);
  await phpRun(php, `lab_flush(); lab_flush();`);

  const batchEvents = await api.events(siteId);
  const batchCount = (batchEvents.body.events || []).filter((e) => e.type === 'cron_added').length;
  note('queue', 'All batched events arrive at ScanSite', batchCount === 73, `received ${batchCount}/73`);
  await clearQueue(php);

  /* ------------------------------------------- partial batch */
  const partial = await phpRun(php, `
lab_login_admin();
$e = new ScanSite_BB_Events();
$e->enqueue( 'login_failed', 'auth', array( 'metadata' => array( 'labTag' => 'partial' ) ) );
$q = get_option( ScanSite_BB_Events::OPT_QUEUE, array() );
$q[] = array( 'eventId' => 'evt_no_type_at_all' );   // malformed
update_option( ScanSite_BB_Events::OPT_QUEUE, $q, false );
lab_flush();
lab_dump('partial', array( 'queued' => ScanSite_BB_Events::queue_size(), 'state' => ScanSite_BB_Connection::state() ) );`);
  const partEvents = await api.events(siteId);
  const validArrived = (partEvents.body.events || []).some((e) => e.type === 'login_failed');
  note('queue', 'One bad event does not fail the whole batch', validArrived && partial.markers.partial?.queued === 0, `validArrived=${validArrived} queuedAfter=${partial.markers.partial?.queued}`);
  await clearQueue(php);

  /* ------------------------------------------- performance */
  console.log('\n--- performance ---');
  const perf = await phpRun(php, `
lab_login_admin();
$e = new ScanSite_BB_Events();
$t = microtime( true );
wp_insert_user( array( 'user_login' => 'perf_probe', 'user_pass' => 'X!23456789', 'user_email' => 'perf@wp.local', 'role' => 'subscriber' ) );
lab_dump('createUserMs', round( ( microtime( true ) - $t ) * 1000, 2 ) );

$t = microtime( true );
lab_admin_init();
lab_dump('adminInitMs', round( ( microtime( true ) - $t ) * 1000, 2 ) );

$t = microtime( true );
update_option( 'blogdescription', 'perf ' . microtime( true ) );
lab_dump('optionMs', round( ( microtime( true ) - $t ) * 1000, 2 ) );

// Confirm no request path performs a blocking ScanSite call.
$t = microtime( true );
$e->enqueue( 'collector_test', 'core', array() );
lab_dump('enqueueMs', round( ( microtime( true ) - $t ) * 1000, 2 ) );
lab_dump('queueSize', ScanSite_BB_Events::queue_size() );`);
  const p = perf.markers;
  results.performance = [
    { name: 'wp_insert_user with collector active', ms: p.createUserMs },
    { name: 'admin_init (config + uploads hashing)', ms: p.adminInitMs },
    { name: 'update_option with collector active', ms: p.optionMs },
    { name: 'enqueue one event (no network)', ms: p.enqueueMs },
  ];
  for (const r of results.performance) console.log(`  ${r.name.padEnd(42)} ${r.ms} ms`);
  note('queue', 'Event capture is local and fast (no network)', p.enqueueMs < 25, `${p.enqueueMs} ms to enqueue`);
  note('queue', 'admin_init file hashing stays cheap', p.adminInitMs < 500, `${p.adminInitMs} ms`);
  await phpRun(php, `
require_once ABSPATH . 'wp-admin/includes/user.php';
$u = get_user_by( 'login', 'perf_probe' ); if ( $u ) { wp_delete_user( $u->ID ); }
lab_clear_queue();`);

  /* ------------------------------------------- privacy audit */
  console.log('\n--- privacy audit ---');
  const priv = await phpRun(php, `
lab_login_admin();
lab_clear_queue();
// Exercise the paths most likely to carry sensitive data.
wp_insert_user( array( 'user_login' => 'privacy_probe', 'user_pass' => 'Sup3rSecret!pass', 'user_email' => 'p@wp.local', 'role' => 'subscriber' ) );
wp_authenticate( 'privacy_probe', 'wrong-password-value' );
wp_schedule_event( time() + 3600, 'hourly', 'privacy_hook', array( 'token' => 'abc123', 'api_key' => 'k' ) );
update_option( 'scansite_probe_option', array( 'password' => 'x', 'stripe_key' => 'y', 'safe' => 'z' ) );
do_action( 'shutdown' );
$q = lab_queue();
lab_dump('events', $q );
lab_dump('raw', wp_json_encode( $q ) );`);
  const raw = priv.markers.raw || '';
  const patterns = ['password', 'passwd', 'secret', 'token', 'api_key', 'apikey', 'authorization', 'cookie', 'stripe', 'smtp', 'private_key', 'DB_PASSWORD', 'AUTH_KEY', 'NONCE_KEY', 'Sup3rSecret', 'wrong-password-value', 'abc123'];
  const hits = patterns.filter((pt) => raw.toLowerCase().includes(pt.toLowerCase()));
  note('queue', 'No secret-like keys or values in real payloads', hits.length === 0, hits.length ? `FOUND: ${hits.join(', ')}` : `scanned ${patterns.length} patterns across ${raw.length} bytes`);

  const cronEv = (priv.markers.events || []).find((e) => e.type === 'cron_added');
  note('queue', 'Cron args are not transmitted (count + hash only)',
    cronEv && cronEv.metadata?.argCount === 2 && !!cronEv.metadata?.argsHash && !JSON.stringify(cronEv).includes('abc123'),
    `argCount=${cronEv?.metadata?.argCount} argsHash=${cronEv?.metadata?.argsHash} rawArgsSent=${JSON.stringify(cronEv).includes('abc123')}`);
  /* The privacy filter itself. The audit above scans whatever real events
   * happened to be captured; if none carried a secret-shaped key it would not
   * notice the sanitizer breaking. This exercises it directly, at depth. */
  const san = await phpRun(php, `
lab_clear_queue();
$e = new ScanSite_BB_Events();
$e->enqueue( 'collector_test', 'core', array(
	'metadata' => array(
		'password'   => 'hunter2',
		'api_key'    => 'sk_live_abc',
		'safe'       => 'keep-me',
		'nested'     => array(
			'user_secret' => 'deep-value',
			'cookie'      => 'auth=1',
			'ok'          => 42,
		),
		'objectlike' => new stdClass(),
	),
) );
$q = lab_queue();
lab_dump('san', array(
	'json'     => wp_json_encode( isset( $q[0] ) ? $q[0] : null ),
	'keptSafe' => isset( $q[0]['metadata']['safe'] ) ? $q[0]['metadata']['safe'] : null,
	'keptOk'   => isset( $q[0]['metadata']['nested']['ok'] ) ? $q[0]['metadata']['nested']['ok'] : null,
) );`);
  const sanJson = san.markers.san?.json || '';
  const leaked = ['hunter2', 'sk_live_abc', 'deep-value', 'auth=1'].filter((v) => sanJson.includes(v));
  note('queue', 'Sanitizer strips secret-shaped keys at any depth',
    leaked.length === 0 && san.markers.san?.keptSafe === 'keep-me' && Number(san.markers.san?.keptOk) === 42,
    `leaked=${leaked.length ? leaked.join(',') : 'none'} keptSafe=${san.markers.san?.keptSafe} keptNestedOk=${san.markers.san?.keptOk}`);

  await phpRun(php, `
require_once ABSPATH . 'wp-admin/includes/user.php';
$u = get_user_by( 'login', 'privacy_probe' ); if ( $u ) { wp_delete_user( $u->ID ); }
wp_clear_scheduled_hook( 'privacy_hook' );
delete_option( 'scansite_probe_option' );
lab_clear_queue();`);

  /* ------------------------------------------- schema + timestamps + IP */
  console.log('\n--- payload contract ---');
  const contract = await phpRun(php, `
lab_login_admin();
lab_clear_queue();
$e = new ScanSite_BB_Events();
$e->enqueue( 'collector_test', 'core', array() );
$q = lab_queue();
lab_dump('event', $q[0] );
lab_dump('ids', array_map( function ( $x ) { return $x['eventId']; }, $q ) );
$e->enqueue( 'collector_test', 'core', array() );
$q2 = lab_queue();
lab_dump('uniqueIds', count( array_unique( array_map( function ( $x ) { return $x['eventId']; }, $q2 ) ) ) === count( $q2 ) );`);
  const ce = contract.markers.event || {};
  note('queue', 'schemaVersion present on every event', ce.schemaVersion === 1, `schemaVersion=${ce.schemaVersion}`);
  note('queue', 'Timestamps are ISO 8601 UTC', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(ce.timestamp || ''), ce.timestamp);
  note('queue', 'Server stores UTC (offset +00:00)', /\+00:00$|Z$/.test(ce.timestamp || ''), ce.timestamp);
  note('queue', 'eventId is unique', contract.markers.uniqueIds === true, `uniqueIds=${contract.markers.uniqueIds}`);
  note('queue', 'IP comes from REMOTE_ADDR only', ce.actor?.ip === '203.0.113.9', `ip=${ce.actor?.ip} (REMOTE_ADDR was 203.0.113.9)`);

  const spoof = await phpRun(php, `
lab_login_admin();
$_SERVER['HTTP_X_FORWARDED_FOR'] = '198.51.100.77';
$_SERVER['HTTP_X_REAL_IP'] = '198.51.100.77';
lab_clear_queue();
$e = new ScanSite_BB_Events();
$e->enqueue( 'login_failed', 'auth', array() );
$q = lab_queue();
lab_dump('ip', $q[0]['actor']['ip'] );`);
  note('queue', 'Forwarded headers are not trusted', spoof.markers.ip === '203.0.113.9', `recorded ip=${spoof.markers.ip}`);
  await clearQueue(php);

  /* ------------------------------- vocabulary cross-check -------------- *
   * The collector and ScanSite define their event vocabularies separately.
   * A type the collector emits but ScanSite does not recognise is silently
   * retried five times and then dropped, so the two lists are compared here
   * by scanning the collector's own source rather than by hand.
   */
  console.log('\n--- event vocabulary cross-check ---');
  const vocab = await phpRun(php, `
lab_login_admin();
lab_clear_queue();
$src = file_get_contents( SCANSITE_BB_FILE );
foreach ( (array) glob( SCANSITE_BB_DIR . 'includes/class-*.php' ) as $f ) {
	$src .= "\\n" . file_get_contents( $f );
}
preg_match_all( "/enqueue\\(\\s*'([a-z_]+)',\\s*'([a-z_]+)'/", $src, $m, PREG_SET_ORDER );
$pairs = array();
foreach ( $m as $hit ) { $pairs[ $hit[1] ] = $hit[2]; }
// Config-file events are keyed by type in the watch target map.
preg_match_all( "/'(wp_config_modified|htaccess_modified)'\\s*=>/", $src, $m2 );
foreach ( $m2[1] as $t ) { $pairs[ $t ] = 'config'; }
// Types chosen by a ternary or built from $type at runtime.
foreach ( array( 'administrator_created', 'user_created', 'user_role_changed' ) as $t ) { $pairs[ $t ] = 'user'; }
foreach ( array( 'plugin_installed', 'plugin_updated' ) as $t ) { $pairs[ $t ] = 'plugin'; }
foreach ( array( 'theme_installed', 'theme_updated' ) as $t ) { $pairs[ $t ] = 'theme'; }
ksort( $pairs );

$e = new ScanSite_BB_Events();
$n = 0;
foreach ( $pairs as $type => $category ) {
	$e->enqueue( $type, $category, array( 'metadata' => array( 'labTag' => 'vocab', 'seq' => $n ) ) );
	$n++;
}
lab_dump('vocabTypes', $pairs );
lab_dump('queued', ScanSite_BB_Events::queue_size() );
lab_flush();
lab_dump('queueAfter', ScanSite_BB_Events::queue_size() );
lab_dump('state', ScanSite_BB_Connection::state() );`);

  const pairs = vocab.markers.vocabTypes || {};
  const names = Object.keys(pairs);
  const arrived = await api.events(siteId);
  const serverTypes = new Set((arrived.body.events || []).filter((e) => e.metadata?.labTag === 'vocab').map((e) => e.type));
  const missing = names.filter((n) => !serverTypes.has(n));
  console.log(`  collector emits ${names.length} event types; ScanSite accepted ${serverTypes.size}`);
  note('queue', 'Every collector event type is accepted by ScanSite', missing.length === 0, missing.length ? `REJECTED: ${missing.join(', ')}` : `${names.length}/${names.length} accepted`);
  results.eventTypes = { emitted: names, accepted: names.filter((n) => serverTypes.has(n)), rejected: missing };
  await clearQueue(php);

  return results;
}
