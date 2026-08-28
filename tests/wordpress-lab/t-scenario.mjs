/**
 * Final validation scenario — one controlled, benign multi-event sequence on
 * real WordPress, delivered to ScanSite and inspected end to end.
 *
 * Nothing here is malicious: a plugin update, a temporary administrator, a
 * harmless PHP file in uploads and a custom cron hook. The point is to confirm
 * that real events correlate, group and produce evidence correctly — not to
 * force a particular severity.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { phpRun, clearQueue, api, note, results, LAB, REPO } from './harness.mjs';

const types = (l) => l.map((e) => e.type);

export async function runScenario(php, siteId) {
  console.log('\n' + '='.repeat(72));
  console.log('FINAL SCENARIO — benign multi-event sequence on real WordPress');
  console.log('='.repeat(72));

  await clearQueue(php);

  const run = await phpRun(php, `
lab_login_admin();
require_once ABSPATH . 'wp-admin/includes/user.php';
require_once ABSPATH . 'wp-admin/includes/file.php';

// 1. A real plugin update through the WordPress updater.
$plugDir = WP_PLUGIN_DIR . '/lab-test-plugin';
if ( ! is_dir( $plugDir ) ) { wp_mkdir_p( $plugDir ); }
file_put_contents( $plugDir . '/lab-test-plugin.php', "<?php\\n/**\\n * Plugin Name: Lab Test Plugin\\n * Version: 1.0.1\\n */\\n" );
if ( ! is_plugin_active( 'lab-test-plugin/lab-test-plugin.php' ) ) {
	require_once ABSPATH . 'wp-admin/includes/plugin.php';
	activate_plugin( 'lab-test-plugin/lab-test-plugin.php' );
}

// 2. A temporary administrator.
$existing = get_user_by( 'login', 'temp_support' );
if ( $existing ) { wp_delete_user( $existing->ID ); }
wp_insert_user( array(
	'user_login' => 'temp_support',
	'user_pass'  => 'TempPass!2345',
	'user_email' => 'temp@wp.local',
	'role'       => 'administrator',
) );

// 3. A harmless PHP file inside uploads.
$uploads = lab_uploads_dir();
$probe   = $uploads . '/scenario-probe.php';
@unlink( $probe );
delete_option( 'scansite_blackbox_upload_hashes' );
lab_admin_init();
file_put_contents( $probe, "<?php\\n// Benign ScanSite scenario probe. Never executed.\\necho 'ok';\\n" );
lab_admin_init();

// 4. A harmless custom cron hook.
wp_clear_scheduled_hook( 'scenario_maintenance_hook' );
wp_schedule_event( time() + 3600, 'hourly', 'scenario_maintenance_hook' );

// 5. Deliver everything through the real collector path.
do_action( 'shutdown' );
lab_dump('queued', ScanSite_BB_Events::queue_size() );
lab_dump('types', lab_types( lab_queue() ) );
lab_flush();
lab_dump('queueAfter', ScanSite_BB_Events::queue_size() );`);

  console.log(`  queued ${run.markers.queued}: ${JSON.stringify(run.markers.types)}`);
  console.log(`  after flush: ${run.markers.queueAfter} remaining`);

  /* ------------------------------------------- what ScanSite received */
  const feed = await api.events(siteId);
  const all = feed.body.events || [];
  const relevant = all.filter(
    (e) =>
      ['plugin_installed', 'plugin_activated', 'plugin_updated', 'administrator_created', 'executable_created', 'cron_added', 'active_plugins_changed'].includes(e.type) &&
      !e.metadata?.labTag
  );

  console.log('\n  Raw events received by ScanSite:');
  for (const e of relevant.slice(0, 12).reverse()) {
    const name = e.target?.name ?? e.target?.username ?? e.target?.hook ?? e.path ?? '';
    const change = e.changes?.from || e.changes?.to ? ` (${e.changes?.from ?? '?'} → ${e.changes?.to ?? '?'})` : '';
    console.log(
      `   ${new Date(e.timestamp).toISOString().slice(11, 19)}  ${e.type.padEnd(22)} ${String(name).slice(0, 34).padEnd(34)}${change}` +
        `  actor=${e.actor?.username ?? '-'} ip=${e.actor?.ip ?? '-'}`
    );
  }

  const seen = new Set(relevant.map((e) => e.type));
  note('queue', 'Scenario: plugin event delivered', seen.has('plugin_installed') || seen.has('plugin_activated') || seen.has('plugin_updated'), [...seen].join(', '));
  note('queue', 'Scenario: administrator_created delivered', seen.has('administrator_created'), 'real wp_insert_user with role=administrator');
  note('queue', 'Scenario: executable_created delivered', seen.has('executable_created'), 'real .php written into wp-content/uploads');
  note('queue', 'Scenario: cron_added delivered', seen.has('cron_added'), 'real wp_schedule_event');

  const ids = relevant.map((e) => e.eventId);
  note('queue', 'Scenario: every event has a unique ID', new Set(ids).size === ids.length, `${new Set(ids).size}/${ids.length} unique`);
  const actors = new Set(relevant.map((e) => e.actor?.username).filter(Boolean));
  note('queue', 'Scenario: actor captured on admin actions', actors.has('labadmin'), `actors=${[...actors].join(',')}`);

  /* ------------------------------------------- correlation + grouping */
  const inc = await api.incidents(siteId);
  const list = inc.body.incidents || [];
  console.log(`\n  Incidents for this site: ${list.length}`);
  for (const i of list.slice(0, 5)) {
    console.log(`   ${i.severity.toUpperCase().padEnd(9)} ${i.riskScore}/100  conf ${i.confidence}%  ${i.title}  (${i.eventCount} events)`);
  }

  // The scenario deliberately covers the detectors' inputs; whether they fire
  // depends on the event mix, and the scoring must not be bent to force it.
  const covering = list.filter((i) => (i.events || []).some((ev) => ids.includes(ev.eventId)));
  note('queue', 'Scenario events grouped into an incident', covering.length > 0, covering.length ? covering.map((i) => i.title).join(' | ') : 'no incident — events alone were not correlated');

  if (covering.length) {
    const detail = await api.incident(covering[0].id);
    const d = detail.body.incident;
    console.log(`\n  Incident "${d.title}":`);
    console.log(`   rawScore ${d.rawScore} -> riskScore ${d.riskScore}/100 (${d.severityLabel}), confidence ${d.confidence}% (${d.confidenceLabel})`);
    console.log(`   cause:       ${d.concepts?.cause}`);
    console.log(`   change:      ${d.concepts?.change}`);
    console.log(`   persistence: ${d.concepts?.persistence}`);
    console.log(`   impact:      ${d.concepts?.impact}`);
    console.log(`   chain (${(d.attackChain || []).length}): ${(d.attackChain || []).map((s) => s.step).join(' → ')}`);
    console.log(`   detectors: ${(d.findings || []).map((f) => f.id).join(', ') || 'none'}`);
    console.log(`   evidence: ${(d.evidence || []).length} items citing ${(d.evidence || []).map((ev) => ev.eventId).join(', ')}`);
    const evidenceIds = new Set((d.evidence || []).map((ev) => ev.eventId));
    const chainIds = new Set((d.attackChain || []).map((s) => s.eventId));
    note('queue', 'Incident evidence references real event IDs', [...evidenceIds].every((id) => all.some((e) => e.eventId === id)), `${evidenceIds.size} evidence refs resolved`);
    note('queue', 'Incident chain references real event IDs', [...chainIds].every((id) => all.some((e) => e.eventId === id)), `${chainIds.size} chain refs resolved`);
    results.scenarioIncident = {
      title: d.title,
      severity: d.severity,
      riskScore: d.riskScore,
      rawScore: d.rawScore,
      confidence: d.confidence,
      detectors: (d.findings || []).map((f) => f.id),
      chainLength: (d.attackChain || []).length,
      evidence: (d.evidence || []).length,
    };
  }

  /* ------------------------------------------- fixtures -------------- *
   * A small number of genuine collector payloads, scrubbed of anything
   * identifying, kept so future collector changes are checked against what a
   * real WordPress actually sends.
   */
  const fixtureDir = join(REPO, 'tests', 'fixtures', 'blackbox', 'real-wordpress');
  mkdirSync(fixtureDir, { recursive: true });
  const wanted = ['plugin_activated', 'administrator_created', 'cron_added', 'executable_created', 'login_success'];
  const written = [];
  for (const t of wanted) {
    const e = all.filter((x) => x.type === t && !x.metadata?.labTag).pop();
    if (!e) continue;
    const clean = sanitizeFixture(e);
    const file = join(fixtureDir, `${t}.json`);
    writeFileSync(file, JSON.stringify(clean, null, 2) + '\n');
    written.push(`${t}.json`);
  }
  console.log(`\n  Fixtures written to tests/fixtures/blackbox/real-wordpress/: ${written.join(', ') || 'none'}`);
  note('queue', 'Real payload fixtures saved', written.length >= 4, `${written.length} files`);
  results.fixtures = written;

  // Prove the fixtures are actually scrubbed.
  const leaks = [];
  for (const f of written) {
    const raw = readFileSync(join(fixtureDir, f), 'utf8');
    for (const bad of ['labadmin', '203.0.113.9', 'wp.local', 'sk_bb_']) if (raw.includes(bad)) leaks.push(`${f}:${bad}`);
  }
  note('queue', 'Fixtures contain no real host, IP, username or key', leaks.length === 0, leaks.length ? leaks.join(', ') : `${written.length} fixtures scanned`);

  // Clean the lab back to a known state.
  await phpRun(php, `
require_once ABSPATH . 'wp-admin/includes/user.php';
$u = get_user_by( 'login', 'temp_support' ); if ( $u ) { wp_delete_user( $u->ID ); }
wp_clear_scheduled_hook( 'scenario_maintenance_hook' );
$probe = lab_uploads_dir() . '/scenario-probe.php';
@unlink( $probe );
lab_admin_init();
lab_clear_queue();`);

  return results;
}

/**
 * Strip anything identifying from a real payload before it becomes a fixture.
 * The shape is preserved exactly — only values are replaced.
 */
function sanitizeFixture(e) {
  const out = JSON.parse(JSON.stringify(e));
  out.siteId = 'site_example000000';
  if (out.actor) {
    if (out.actor.username) out.actor.username = 'example_admin';
    if (out.actor.ip) out.actor.ip = '192.0.2.10';
    if (out.actor.userId) out.actor.userId = 1;
  }
  if (out.target?.username) out.target.username = 'example_user';
  if (out.site) out.site = 'site_example000000';
  if (typeof out.path === 'string') out.path = out.path.replace(/wp\.local/g, 'example.test');
  return out;
}
