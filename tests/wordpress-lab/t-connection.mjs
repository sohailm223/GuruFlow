/**
 * GOAL 1 — connection validation against real WordPress.
 *
 * Runs the plugin's real ScanSite_BB_Connection::connect() inside WordPress,
 * against the real ScanSite HTTP API. No transport is mocked.
 */
import { readFileSync, writeFileSync, existsSync, truncateSync } from 'node:fs';
import { join } from 'node:path';
import {
  LAB, WP_ENDPOINT, api, requireScanSite, phpRun, queue, flush, note, bug, results,
} from './harness.mjs';
import { boot } from './runtime.mjs';

const ERRLOG = join(LAB, 'wp', 'wp-content', 'php-error.log');
const CONNECTIONS = join(LAB, '..', '..', 'data', 'blackbox', 'connections.json');

function phpErrorsSince(mark) {
  if (!existsSync(ERRLOG)) return [];
  const raw = readFileSync(ERRLOG, 'utf8');
  return raw.slice(mark).split('\n').filter((l) => l.trim().length > 0);
}
function errlogPos() {
  return existsSync(ERRLOG) ? readFileSync(ERRLOG, 'utf8').length : 0;
}

export async function runConnectionTests(php) {
  console.log('\n' + '='.repeat(72));
  console.log('GOAL 1 — CONNECTION VALIDATION (real WordPress → real ScanSite)');
  console.log('='.repeat(72));

  await requireScanSite();
  const logPos = errlogPos();

  /* ---------------------------------------------------------- pairing */
  const site = await api.createSite('ScanSite WP Lab', 'http://wp.local');
  if (site.status !== 201) throw new Error(`createSite failed: ${site.status} ${JSON.stringify(site.body)}`);
  const siteId = site.body.site.id;
  const code = site.body.connection.code;
  console.log(`\nScanSite site ${siteId} created, pairing code ${code}`);

  /* ------------------------------------------------- real connect() */
  const r = await phpRun(php, `
lab_dump('connect', ScanSite_BB_Connection::connect( '${code}', '${WP_ENDPOINT}' ) === true
	? 'true' : ( is_wp_error( ScanSite_BB_Connection::last_error() ) ? 'err' : 'false' ) );
lab_dump('opts', array(
	'siteId'   => ScanSite_BB_Connection::site_id(),
	'keyLen'   => strlen( (string) ScanSite_BB_Connection::collector_key() ),
	'keyHead'  => substr( (string) ScanSite_BB_Connection::collector_key(), 0, 6 ),
	'endpoint' => ScanSite_BB_Connection::endpoint(),
	'state'    => ScanSite_BB_Connection::state(),
	'connected'=> ScanSite_BB_Connection::is_connected() ? 'yes' : 'no',
) );`);

  const opts = r.markers.opts;
  note('connection', 'Plugin activates without fatal error', true, 'WordPress 6.8.3 loaded the collector');
  note('connection', 'Pairing code accepted by ScanSite', opts.siteId === siteId, `siteId=${opts.siteId}`);
  note('connection', 'Collector key stored in WordPress', opts.keyLen > 40 && opts.keyHead === 'sk_bb_', `len=${opts.keyLen} prefix=${opts.keyHead}`);
  note('connection', 'Connection state became connected', opts.state === 'connected' && opts.connected === 'yes', `state=${opts.state}`);

  const afterConnect = await api.getSite(siteId);
  note('connection', 'ScanSite marks site connected', afterConnect.body.site.connectionStatus === 'connected', afterConnect.body.site.connectionStatus);

  /* ------------------------------- key never displayed again */
  const admin = await phpRun(php, `
$uid = lab_admin_context();
lab_dump('adminUser', $uid );
lab_dump('menu', array(
	'registered' => ! empty( $GLOBALS['menu'] ) && in_array( 'scansite-blackbox', array_column( array_filter( (array) $GLOBALS['menu'] ), 2 ), true ),
	'slugs'      => array_values( array_filter( array_map( function ( $m ) { return $m[2] ?? null; }, (array) $GLOBALS['menu'] ) ) ),
) );
ob_start();
ScanSite_BB_Admin::instance()->render();
$html = ob_get_clean();
lab_dump('htmlLen', strlen( $html ) );
lab_dump('leak', array(
	'hasRawKey'   => false !== strpos( $html, ScanSite_BB_Connection::collector_key() ),
	'hasKeyPrefix'=> false !== strpos( $html, 'sk_bb_' ),
	'hasTitle'    => false !== strpos( $html, 'ScanSite Black Box' ),
) );`, { admin: true });
  note('connection', 'Admin menu appears', admin.markers.menu?.registered === true, `menu slugs=${JSON.stringify(admin.markers.menu?.slugs)}`);
  note('connection', 'Collector key not displayed again', admin.markers.leak?.hasRawKey === false && admin.markers.leak?.hasKeyPrefix === false, `rawKey=${admin.markers.leak?.hasRawKey} prefix=${admin.markers.leak?.hasKeyPrefix}`);
  note('connection', 'Connection screen renders', (admin.markers.htmlLen || 0) > 500, `${admin.markers.htmlLen} bytes of HTML`);

  /* ------------------------------------------------- heartbeat */
  const before = await api.getSite(siteId);
  const hb = await phpRun(php, `
ScanSite_BB_Heartbeat::instance()->send();
lab_dump('lastHb', get_option( 'scansite_blackbox_last_heartbeat' ) );
lab_dump('state', ScanSite_BB_Connection::state() );`);
  const after = await api.getSite(siteId);
  const seenBefore = before.body.site.lastSeenAt || 0;
  const seenAfter = after.body.site.lastSeenAt || 0;
  note('connection', 'Heartbeat reaches ScanSite', seenAfter > 0 && hb.markers.lastHb > 0, `lastSeenAt ${seenBefore} -> ${seenAfter}`);
  note('connection', 'Heartbeat reports real versions', after.body.site.wordpress?.wordpressVersion === '6.8.3', `wp=${after.body.site.wordpress?.wordpressVersion} php=${after.body.site.wordpress?.phpVersion} collector=${after.body.site.collectorVersion}`);

  /* ------------------------------------------------- test event */
  const test = await phpRun(php, `lab_dump('test', ScanSite_BB_Collector::run_connection_test() === true ? 'true' : 'false');`);
  const verify = await api.verifySite(siteId);
  note('connection', 'Send Test Event reaches ScanSite', test.markers.test === 'true', 'run_connection_test() returned true');
  note('connection', 'ScanSite verify confirms receipt', verify.status === 200 && verify.body.success !== false, JSON.stringify(verify.body.checks || verify.body));

  /* ------------------------------------------------- failures */
  console.log('\n  --- failure paths ---');

  const bogus = await phpRun(php, `
$res = ScanSite_BB_Connection::connect( 'ZZZZ-9999', '${WP_ENDPOINT}' );
lab_dump('bogus', array( is_wp_error( $res ) ? 'wp_error' : 'ok', is_wp_error( $res ) ? $res->get_error_message() : '', ScanSite_BB_Connection::state(), ScanSite_BB_Connection::last_error() ) );`);
  note('connection', 'Invalid pairing code rejected', bogus.markers.bogus[0] === 'wp_error', bogus.markers.bogus[1]);

  const reuse = await phpRun(php, `
$res = ScanSite_BB_Connection::connect( '${code}', '${WP_ENDPOINT}' );
lab_dump('reuse', array( is_wp_error( $res ) ? 'wp_error' : 'ok', is_wp_error( $res ) ? $res->get_error_message() : '' ) );`);
  note('connection', 'Already-used pairing code rejected', reuse.markers.reuse[0] === 'wp_error', reuse.markers.reuse[1]);

  // Force a genuinely expired code by editing the store the dev server reads.
  const fresh = await api.reconnect(siteId);
  const newCode = fresh.body?.connection?.code;
  let expiredOk = false;
  let expiredMsg = '';
  if (newCode && existsSync(CONNECTIONS)) {
    const rows = JSON.parse(readFileSync(CONNECTIONS, 'utf8'));
    const row = rows.find((x) => x.code === newCode);
    if (row) {
      row.codeExpiresAt = Date.now() - 1000;
      writeFileSync(CONNECTIONS, JSON.stringify(rows, null, 2));
      const exp = await phpRun(php, `
$res = ScanSite_BB_Connection::connect( '${newCode}', '${WP_ENDPOINT}' );
lab_dump('expired', array( is_wp_error( $res ) ? 'wp_error' : 'ok', is_wp_error( $res ) ? $res->get_error_message() : '' ) );`);
      expiredOk = exp.markers.expired[0] === 'wp_error';
      expiredMsg = exp.markers.expired[1];
    }
  }
  note('connection', 'Expired pairing code rejected', expiredOk, expiredMsg || 'could not force expiry');

  const badEndpoint = await phpRun(php, `
$res = ScanSite_BB_Connection::connect( '${code}', 'http://127.0.0.1:9' );
lab_dump('bad', array( is_wp_error( $res ) ? 'wp_error' : 'ok', is_wp_error( $res ) ? $res->get_error_message() : '', ScanSite_BB_Connection::last_error() ) );`);
  note('connection', 'Wrong ScanSite endpoint fails gracefully', badEndpoint.markers.bad[0] === 'wp_error', badEndpoint.markers.bad[2] || badEndpoint.markers.bad[1]);

  // Restore the good connection for the remaining tests.
  const rep = await api.reconnect(siteId);
  const goodCode = rep.body.connection.code;
  await phpRun(php, `lab_dump('re', ScanSite_BB_Connection::connect( '${goodCode}', '${WP_ENDPOINT}' ) === true ? 'true' : 'false');`);

  // Invalid collector key.
  const keyStored = await phpRun(php, `lab_dump('k', ScanSite_BB_Connection::collector_key());`);
  const realKey = keyStored.markers.k;
  const wrongKey = realKey.slice(0, -4) + 'zzzz';
  const badKeyRes = await fetch(`${WP_ENDPOINT}/api/blackbox/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-ScanSite-Site': siteId, 'X-ScanSite-Key': wrongKey },
    body: JSON.stringify({ site: siteId, events: [{ eventId: 'evt_badkey', type: 'plugin_activated' }] }),
  });
  const badKeyBody = await badKeyRes.json();
  note('connection', 'Invalid collector key rejected', badKeyRes.status === 401, `${badKeyRes.status} ${badKeyBody.error}`);

  // Disconnected site. Queue an event first: flush() returns early on an empty
  // queue, so with nothing queued no delivery is attempted and the state never
  // changes — which would make this check vacuous.
  await api.disconnect(siteId);
  await phpRun(php, `$e = new ScanSite_BB_Events();
$e->enqueue( 'plugin_activated', 'plugin', array( 'target' => array( 'plugin' => 'disconnected-probe', 'name' => 'Disconnected Probe' ), 'metadata' => array( 'labTag' => 'disconnect-probe' ) ) );`);
  const f = await flush(php);
  note('connection', 'Disconnected site stops delivery', f.markers.state?.[0] === 'error', `state=${f.markers.state?.[0]} msg=${f.markers.state?.[1]}`);

  // Reconnect.
  const rc = await api.reconnect(siteId);
  const rcRes = await phpRun(php, `lab_dump('rc', ScanSite_BB_Connection::connect( '${rc.body.connection.code}', '${WP_ENDPOINT}' ) === true ? 'true' : 'false');`);
  note('connection', 'Reconnect restores the collector', rcRes.markers.rc === 'true', 'new code redeemed from WordPress');

  /* ------------------------------------------------- PHP errors */
  const errs = phpErrorsSince(logPos);
  const unique = [...new Set(errs.map((e) => e.replace(/^\[[^\]]+\]\s*/, '').slice(0, 160)))];
  results.connectionPhpErrors = unique;
  note('connection', 'No PHP notices/warnings during connection flow', unique.length === 0, unique.length ? `${unique.length} distinct: ${unique[0]}` : 'clean');
  if (unique.length) {
    for (const u of unique) {
      if (/_load_textdomain_just_in_time/.test(u)) {
        bug('WP-1', 'Plugin calls __() before init — WordPress 6.7+ raises a PHP Notice on every load', 'Move translation out of the plugin-load path');
      }
    }
  }

  return siteId;
}
