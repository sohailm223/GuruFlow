/**
 * Likely infection path, guided fix and verification suite.
 *
 * Two halves, both against the shipped code:
 *
 *   1. Unit — classifyEntryPoint / buildRemediationPlan / evaluateVerification
 *      imported directly, so a wording or ordering regression is caught even
 *      when no server is running.
 *   2. Live — the same logic through POST /ingest → GET /incident → POST /verify
 *      and through the rendered incident page.
 *
 *   node tests/blackbox/remediation.mjs
 *
 * Requires a running ScanSite server (see README for the env vars).
 */

import crypto from 'crypto';
import http from 'http';
import { classifyEntryPoint } from '../../src/lib/blackbox/entrypoint.js';
import { buildRemediationPlan, buildPrevention, evaluateVerification } from '../../src/lib/blackbox/remediation.js';

const BASE = process.env.SCANSITE_URL || 'http://127.0.0.1:3000';
const MINUTE = 60_000;

const ADMIN_USER = process.env.SCANSITE_ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.SCANSITE_ADMIN_PASSWORD || 'scansite-test-pass';
let ADMIN_COOKIE = '';

let pass = 0;
let fail = 0;
function check(name, condition, detail = '') {
  if (condition) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

function signed(site, key, body) {
  const raw = JSON.stringify(body ?? {});
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomBytes(16).toString('hex');
  const sig = crypto.createHmac('sha256', key).update(`${ts}.${nonce}.${raw}`).digest('hex');
  return {
    'X-ScanSite-Site': site,
    'X-ScanSite-Key': key,
    'X-ScanSite-Timestamp': ts,
    'X-ScanSite-Nonce': nonce,
    'X-ScanSite-Signature': `sha256=${sig}`,
  };
}

{
  const r = await fetch(BASE + '/api/blackbox/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
  });
  const c = (r.headers.getSetCookie?.() ?? []).find((s) => s.startsWith('scansite_session='));
  if (c) ADMIN_COOKIE = c.split(';')[0];
}

async function call(method, path, body, headers = {}) {
  if (typeof headers === 'function') headers = headers(body);
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(ADMIN_COOKIE ? { Cookie: ADMIN_COOKIE } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const isHtml = (res.headers.get('content-type') ?? '').includes('text/html');
  return { status: res.status, body: isHtml ? null : await res.json().catch(() => null), html: isHtml ? await res.text() : null };
}

const createdSites = [];
async function provision(name, url) {
  const created = await call('POST', '/api/blackbox/sites', { name, url, environment: 'development' });
  const siteId = created.body.site.id;
  createdSites.push(siteId);
  const conn = await call('POST', '/api/blackbox/connect', { code: created.body.connection.code, siteUrl: url });
  return { siteId, key: conn.body.collectorKey, url: created.body.site.url };
}

const uniq = () => crypto.randomBytes(4).toString('hex');

/* ========================================================================== *
 * 1. UNIT — entry point classification
 * ========================================================================== */
console.log('\nEntry point classification (unit)');

const T0 = Date.parse('2026-03-01T10:00:00.000Z');
const at = (mins) => T0 + mins * MINUTE;

const adminChainEvents = [
  { eventId: 'u1', timestamp: at(0), type: 'administrator_created', category: 'user', actor: { username: 'mallory', ip: '198.51.100.12' }, target: { username: 'mallory' }, changes: { to: 'administrator' } },
  { eventId: 'u2', timestamp: at(6), type: 'executable_created', category: 'file', actor: { username: 'mallory', ip: '198.51.100.12' }, path: '/wp-content/uploads/cache/z.php' },
  { eventId: 'u3', timestamp: at(9), type: 'cron_added', category: 'cron', actor: { username: 'mallory', ip: '198.51.100.12' }, target: { hook: 'wp_daily_sync_task' } },
  { eventId: 'u4', timestamp: at(12), type: 'site_error_burst', category: 'availability', metadata: { httpStatus: 500 } },
];

const admin = classifyEntryPoint(adminChainEvents, { knownIps: new Set(['203.0.113.7']) });
check('Privilege escalation classifies as compromised admin account', admin.id === 'compromised_admin', admin.id);
check('Compromised-admin headline is hedged', /possible|likely|may be/i.test(admin.headline) && !/was infected|confirmed compromise/i.test(admin.headline), admin.headline);
check('Confidence is between 25 and 90 — never certain', admin.confidence >= 25 && admin.confidence <= 90, String(admin.confidence));
check('Confidence label matches the number', admin.confidenceLabel === 'Likely' && admin.confidence >= 75, `${admin.confidence} ${admin.confidenceLabel}`);
check('Every reason cites a real event id', admin.reasons.length >= 3 && admin.reasons.every((r) => adminChainEvents.some((e) => e.eventId === r.eventId)), JSON.stringify(admin.reasons.map((r) => r.eventId)));
check('Reasons name the account, the IP, the PHP file and the cron hook',
  ['mallory', '198.51.100.12', 'z.php', 'wp_daily_sync_task'].every((needle) => admin.reasons.some((r) => r.text.includes(needle))),
  JSON.stringify(admin.reasons.map((r) => r.text)));
check('Unknown IP is asserted only because it is absent from earlier events',
  admin.reasons.some((r) => /does not appear in this site's earlier events/.test(r.text)));
check('Chain runs login → admin access → PHP file → cron → failure',
  admin.chain.map((c) => c.label).join(' > ') === 'Unknown Login / Account > Administrator Access > Unexpected PHP File > Cron Persistence > Website Failure',
  admin.chain.map((c) => c.label).join(' > '));
check('Every chain step is backed by an event', admin.chain.every((c) => adminChainEvents.some((e) => e.eventId === c.eventId)));
check('Target points at the real account', admin.target?.kind === 'account' && admin.target?.username === 'mallory', JSON.stringify(admin.target));

// The same events with the attacker's IP already known must not claim novelty.
const adminKnownIp = classifyEntryPoint(adminChainEvents, { knownIps: new Set(['198.51.100.12']) });
check('A previously seen IP is not reported as unknown',
  !adminKnownIp.reasons.some((r) => /does not appear in this site's earlier events/.test(r.text)));
check('Without knownIps no novelty claim is made at all',
  !classifyEntryPoint(adminChainEvents).reasons.some((r) => /does not appear/.test(r.text)));

const pluginEvents = [
  { eventId: 'p1', timestamp: at(0), type: 'plugin_file_mismatch', category: 'plugin', target: { plugin: 'woocommerce', name: 'woocommerce' }, changes: { from: '8.1.0' } },
  { eventId: 'p2', timestamp: at(5), type: 'executable_created', category: 'file', path: '/wp-content/uploads/cache/x.php' },
  { eventId: 'p3', timestamp: at(7), type: 'cron_added', category: 'cron', target: { hook: 'wc_cache_flush' } },
  { eventId: 'p4', timestamp: at(8), type: 'unexpected_redirect', category: 'redirect', target: { name: 'search' } },
  { eventId: 'p5', timestamp: at(10), type: 'site_error_burst', category: 'availability', metadata: { httpStatus: 500 } },
];
const plugin = classifyEntryPoint(pluginEvents);
check('Plugin file mismatch classifies as vulnerable plugin', plugin.id === 'vulnerable_plugin', plugin.id);
check('Plugin target carries the plugin name', plugin.target?.kind === 'plugin' && plugin.target?.name === 'woocommerce', JSON.stringify(plugin.target));
check('Plugin chain is Plugin → PHP → Cron → Redirect → Failure',
  plugin.chain.map((c) => c.label).join(' > ') === 'Plugin Activity > Unknown PHP > Cron > Redirect > Website Failure',
  plugin.chain.map((c) => c.label).join(' > '));
check('No vulnerability-database or CVE claim is made',
  !/known vulnerability|CVE-\d|exploit for/i.test(JSON.stringify(plugin)), plugin.headline);

const themeEntry = classifyEntryPoint([{ eventId: 't1', timestamp: at(0), type: 'theme_file_mismatch', category: 'theme', target: { theme: 'twentytwentyfour' } }]);
check('Theme file mismatch classifies as vulnerable theme', themeEntry.id === 'vulnerable_theme', themeEntry.id);

const appPwd = classifyEntryPoint([
  { eventId: 'a1', timestamp: at(0), type: 'application_password_created', category: 'user', actor: { username: 'editor1', ip: '198.51.100.40' }, target: { name: 'CI Bot' } },
  { eventId: 'a2', timestamp: at(4), type: 'executable_created', category: 'file', path: '/wp-content/uploads/tmp/a.php' },
]);
check('Application password activity classifies as stolen application password', appPwd.id === 'stolen_application_password', appPwd.id);

const install = classifyEntryPoint([
  { eventId: 'i1', timestamp: at(0), type: 'plugin_installed', category: 'plugin', target: { name: 'seo-helper' } },
  { eventId: 'i2', timestamp: at(3), type: 'executable_created', category: 'file', path: '/wp-content/uploads/tmp/i.php' },
]);
check('A fresh install followed by a stray PHP file is a malicious-install candidate', install.id === 'malicious_plugin_install', install.id);
check('An install on its own is NOT called an entry point',
  classifyEntryPoint([{ eventId: 'i9', timestamp: at(0), type: 'plugin_installed', category: 'plugin', target: { name: 'seo-helper' } }]).id !== 'malicious_plugin_install');

const cfg = classifyEntryPoint([{ eventId: 'c1', timestamp: at(0), type: 'siteurl_changed', category: 'config', changes: { to: 'https://evil.example' } }]);
check('A site URL change classifies as configuration hijack', cfg.id === 'configuration_hijack', cfg.id);

const brute = classifyEntryPoint([
  { eventId: 'b1', timestamp: at(0), type: 'login_failed_burst', category: 'auth', count: 42, target: { username: 'admin' }, metadata: { windowMinutes: 5, ipCount: 3 } },
  { eventId: 'b2', timestamp: at(6), type: 'login_success', category: 'auth', actor: { username: 'admin', ip: '198.51.100.9' } },
]);
check('A failed-login burst followed by a success classifies as brute force', brute.id === 'brute_force_login', brute.id);
check('Brute-force reasons quote the attempt count', brute.reasons.some((r) => /42 failed logins/.test(r.text)), JSON.stringify(brute.reasons));

const uploadOnly = classifyEntryPoint([{ eventId: 'x1', timestamp: at(0), type: 'executable_created', category: 'file', path: '/wp-content/uploads/2026/03/shell.php' }]);
check('A lone executable in uploads is an unexpected file upload', uploadOnly.id === 'unexpected_file_upload', uploadOnly.id);

const nothing = classifyEntryPoint([{ eventId: 'n1', timestamp: at(0), type: 'site_inventory', category: 'site', metadata: { plugins: 12 } }]);
check('Unrelated activity yields Unknown Entry Point, not a guess', nothing.id === 'unknown' && nothing.chain.length === 0, nothing.id);
check('Unknown entry point reports zero confidence', nothing.confidence === 0 && nothing.confidenceLabel === 'Uncertain');

// Two explanations within 10 points of each other: plugin files changed (47)
// and .htaccess modified (40). Neither should be presented as settled.
const ambiguous = classifyEntryPoint([
  { eventId: 'm1', timestamp: at(0), type: 'plugin_file_mismatch', category: 'plugin', target: { plugin: 'contact-form-7' } },
  { eventId: 'm2', timestamp: at(1), type: 'htaccess_modified', category: 'config' },
]);
check('Two near-equal explanations lower confidence and are disclosed',
  ambiguous.caveats.some((c) => /fits this window almost as well/.test(c)) && ambiguous.confidence < 90,
  JSON.stringify(ambiguous.caveats));
check('Candidate list is exposed for diagnostics', Array.isArray(ambiguous.candidates) && ambiguous.candidates.length >= 2);

/* ========================================================================== *
 * 2. UNIT — fix plan, prevention, verification semantics
 * ========================================================================== */
console.log('\nRemediation plan (unit)');

const planIncident = { entryPoint: admin, events: adminChainEvents };
const plan = buildRemediationPlan(planIncident);
check('First priority is Secure Access', plan.priorities[0].title === 'Secure Access', plan.priorities[0]?.title);
check('Priority order puts files before persistence, persistence before integrity',
  plan.priorities.map((p) => p.id).join(',') === 'secure-access,suspicious-files,persistence,integrity',
  plan.priorities.map((p) => p.id).join(','));
check('Plan names the real account', JSON.stringify(plan).includes('mallory'));
check('Plan names the real file path', JSON.stringify(plan).includes('wp-content/uploads/cache/z.php'));
check('Plan names the real cron hook', JSON.stringify(plan).includes('wp_daily_sync_task'));
check('stepCount equals the number of checklist items',
  plan.stepCount === plan.priorities.reduce((n, p) => n + p.items.length, 0), String(plan.stepCount));
check('Difficulty is one of Low/Medium/High', ['Low', 'Medium', 'High'].includes(plan.difficulty), plan.difficulty);
check('Guided steps ask a question with options and a No branch',
  plan.guided.length >= 2 && plan.guided.every((s) => s.question && s.options?.length >= 2 && Array.isArray(s.ifNo)));
check('The last guided step is the verification step', plan.guided.at(-1).id === 'final-verification');
check('Nothing in the plan claims ScanSite will change the site', !/ScanSite (will|automatically) (remove|delete|fix)/i.test(JSON.stringify(plan)));

const prevention = buildPrevention(planIncident);
check('Prevention suggests 2FA when an account is involved', prevention.some((p) => /two-factor/i.test(p.text)));
check('Prevention items carry HIGH/MEDIUM/LOW levels', prevention.every((p) => ['HIGH', 'MEDIUM', 'LOW'].includes(p.level)));
check('Uploads hardening only appears when an uploads file is involved',
  prevention.some((p) => /uploads/i.test(p.text)) && buildPrevention({ events: [], entryPoint: null }).every((p) => !/uploads/i.test(p.text)));

console.log('\nVerification semantics (unit)');

const before = evaluateVerification(planIncident, { events: [], files: [], siteStatus: { ok: true, status: 200 } });
check('Checks cover account, file, cron, integrity and availability',
  ['account', 'file', 'cron', 'integrity', 'availability'].every((k) => before.results.some((r) => r.kind === k)),
  before.results.map((r) => r.kind).join(','));
check('With no remediation evidence only the reachable-site check passes',
  before.resolved === 1 && before.results.filter((r) => r.state === 'not_verified').length === 4 && before.canResolve === false,
  `${before.resolved}/${before.total} ${before.results.map((r) => `${r.kind}=${r.state}`).join(' ')}`);
check('An unavailable site is not counted as a pass',
  evaluateVerification(planIncident, { events: [], files: [], siteStatus: { ok: false, status: 302 } }).results.find((r) => r.kind === 'availability').state === 'outstanding');
check('An unreachable site is reported as not verified, not failed',
  evaluateVerification(planIncident, { events: [], files: [], siteStatus: { ok: false, error: 'unreachable' } }).results.find((r) => r.kind === 'availability').state === 'not_verified');

const fixed = evaluateVerification(planIncident, {
  events: [
    { eventId: 'f1', timestamp: at(60), type: 'user_deleted', category: 'user', target: { username: 'mallory' } },
    { eventId: 'f2', timestamp: at(61), type: 'file_deleted', category: 'file', path: '/wp-content/uploads/cache/z.php' },
    { eventId: 'f3', timestamp: at(62), type: 'cron_removed', category: 'cron', target: { hook: 'wp_daily_sync_task' } },
    { eventId: 'f4', timestamp: at(63), type: 'file_integrity_scan_completed', category: 'file', metadata: { critical: 0, filesChecked: 412 } },
  ],
  files: [],
  siteStatus: { ok: true, status: 200 },
});
check('Account, file, cron and integrity resolve on matching evidence', fixed.resolved === fixed.total, `${fixed.resolved}/${fixed.total}`);
check('Incident can be marked resolved once every check passes', fixed.canResolve === true);
check('A file that still exists is outstanding, not resolved',
  evaluateVerification(planIncident, { events: [], files: [{ relativePath: 'wp-content/uploads/cache/z.php', integrityStatus: 'modified' }], siteStatus: { ok: true, status: 200 } })
    .results.find((r) => r.kind === 'file').state === 'outstanding');
check('A scan that still reports critical files is outstanding',
  evaluateVerification(planIncident, { events: [{ eventId: 'f5', timestamp: at(60), type: 'file_integrity_scan_completed', metadata: { critical: 2 } }], files: [], siteStatus: { ok: true, status: 200 } })
    .results.find((r) => r.kind === 'integrity').state === 'outstanding');
// Remediation events are normally grouped INTO the incident they clean up
// (same account, same path, same hook). The checks must still see them.
const merged = evaluateVerification(
  {
    startedAt: at(0),
    entryPoint: admin,
    events: [
      ...adminChainEvents,
      { eventId: 'g1', timestamp: at(40), type: 'user_deleted', category: 'user', target: { username: 'mallory' } },
      { eventId: 'g2', timestamp: at(41), type: 'file_deleted', category: 'file', path: '/wp-content/uploads/cache/z.php' },
      { eventId: 'g3', timestamp: at(42), type: 'cron_removed', category: 'cron', target: { hook: 'wp_daily_sync_task' } },
      { eventId: 'g4', timestamp: at(43), type: 'file_integrity_scan_completed', category: 'file', metadata: { critical: 0, filesChecked: 412 } },
    ],
  },
  {
    events: [
      { eventId: 'g1', timestamp: at(40), type: 'user_deleted', category: 'user', target: { username: 'mallory' } },
      { eventId: 'g2', timestamp: at(41), type: 'file_deleted', category: 'file', path: '/wp-content/uploads/cache/z.php' },
      { eventId: 'g3', timestamp: at(42), type: 'cron_removed', category: 'cron', target: { hook: 'wp_daily_sync_task' } },
      { eventId: 'g4', timestamp: at(43), type: 'file_integrity_scan_completed', category: 'file', metadata: { critical: 0, filesChecked: 412 } },
    ],
    files: [],
    siteStatus: { ok: true, status: 200 },
  }
);
check('Fixes recorded inside the incident window still count', merged.resolved === merged.total, `${merged.resolved}/${merged.total} ${merged.results.map((r) => `${r.kind}=${r.state}`).join(' ')}`);
check('A deletion that predates the file does not count as a fix',
  evaluateVerification(
    { startedAt: at(0), entryPoint: admin, events: [...adminChainEvents, { eventId: 'g9', timestamp: at(1), type: 'file_deleted', category: 'file', path: '/wp-content/uploads/cache/z.php' }] },
    { events: [], files: [], siteStatus: null }
  ).results.find((r) => r.kind === 'file').state === 'not_verified');

check('A demotion away from administrator counts as securing the account',
  evaluateVerification(planIncident, { events: [{ eventId: 'f6', timestamp: at(60), type: 'user_role_changed', category: 'user', target: { username: 'mallory' }, changes: { to: 'subscriber' } }], files: [], siteStatus: null }).results[0].state === 'resolved');

/* ========================================================================== *
 * 3. LIVE — through the API and the rendered page
 * ========================================================================== */
console.log('\nLive: incident, verification round trip, page markup');

if (!ADMIN_COOKIE) {
  console.log('  ! Not logged in — skipping the live half');
} else {
  // A stub origin so the availability check has a real HTTP 200 to find.
  const stub = http.createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  const stubUrl = `http://127.0.0.1:${stub.address().port}`;

  const A = await provision('Remediation Suite', stubUrl);
  const HA = (body) => signed(A.siteId, A.key, body);

  const t0 = Date.now();
  const seeded = [
    { eventId: `ra_${uniq()}`, type: 'administrator_created', category: 'user', timestamp: new Date(t0 - 20 * MINUTE).toISOString(), actor: { username: 'mallory', ip: '198.51.100.12' }, target: { username: 'mallory' }, changes: { to: 'administrator' } },
    { eventId: `re_${uniq()}`, type: 'executable_created', category: 'file', timestamp: new Date(t0 - 14 * MINUTE).toISOString(), actor: { username: 'mallory', ip: '198.51.100.12' }, path: '/wp-content/uploads/cache/z.php', target: { name: 'z.php', path: '/wp-content/uploads/cache/z.php' } },
    { eventId: `rc_${uniq()}`, type: 'cron_added', category: 'cron', timestamp: new Date(t0 - 10 * MINUTE).toISOString(), actor: { username: 'mallory', ip: '198.51.100.12' }, target: { hook: 'wp_daily_sync_task' } },
    { eventId: `rx_${uniq()}`, type: 'site_error_burst', category: 'availability', timestamp: new Date(t0 - 6 * MINUTE).toISOString(), metadata: { httpStatus: 500 } },
  ];
  // Older, unrelated traffic from another IP: makes "unknown IP" verifiable.
  await call('POST', '/api/blackbox/ingest', {
    site: A.siteId,
    events: [{ eventId: `ro_${uniq()}`, type: 'login_success', category: 'auth', timestamp: new Date(t0 - 90 * MINUTE).toISOString(), actor: { username: 'alice', ip: '203.0.113.7' } }],
  }, HA);
  const ing = await call('POST', '/api/blackbox/ingest', { site: A.siteId, events: seeded }, HA);
  check('Fixture events accepted', ing.status === 200 && ing.body?.accepted === 4, JSON.stringify(ing.body).slice(0, 120));

  // /ingest returns incident summaries, not raw ids.
  const incId = (ing.body?.incidents ?? []).find((i) => /privilege escalation/i.test(i.title))?.id ?? ing.body?.incidents?.[0]?.id;
  check('Ingest reports the incident it created', Boolean(incId), JSON.stringify(ing.body?.incidents?.map((i) => i.title)));
  const incRes = await call('GET', `/api/blackbox/incidents/${incId}`);
  const inc = incRes.body?.incident;
  check('Incident carries a likely entry point', inc?.entryPoint?.id === 'compromised_admin', inc?.entryPoint?.id);
  check('Entry point survives persistence intact', (inc?.entryPoint?.reasons ?? []).length >= 3 && (inc?.entryPoint?.chain ?? []).length >= 4);
  check('Incident carries a remediation plan and prevention list',
    Array.isArray(inc?.remediation?.priorities) && inc.remediation.priorities.length >= 3 && Array.isArray(inc?.prevention) && inc.prevention.length >= 3);

  const v1 = await call('POST', `/api/blackbox/incidents/${incId}/verify`);
  check('POST /verify returns 200 with results', v1.status === 200 && Array.isArray(v1.body?.verification?.results), `got ${v1.status}`);
  check('Before the fix nothing is claimed as fixed', v1.body?.verification?.canResolve === false, JSON.stringify(v1.body?.verification?.results?.map((r) => `${r.kind}:${r.state}`)));
  check('The website check really fetched the site (HTTP 200)',
    v1.body?.verification?.results?.find((r) => r.kind === 'availability')?.detail === 'Site responded with HTTP 200',
    v1.body?.verification?.results?.find((r) => r.kind === 'availability')?.detail);

  const afterV1 = await call('GET', `/api/blackbox/incidents/${incId}`);
  check('Verification is persisted on the incident', Number.isFinite(afterV1.body?.incident?.verification?.at));

  // Operator-entered data must survive the re-analysis the next ingest triggers.
  await call('PATCH', `/api/blackbox/incidents/${incId}`, { note: 'Asked the team about mallory' });
  const fixEvents = [
    { eventId: `fa_${uniq()}`, type: 'user_deleted', category: 'user', timestamp: new Date().toISOString(), target: { username: 'mallory' } },
    { eventId: `ff_${uniq()}`, type: 'file_deleted', category: 'file', timestamp: new Date().toISOString(), path: '/wp-content/uploads/cache/z.php' },
    { eventId: `fc_${uniq()}`, type: 'cron_removed', category: 'cron', timestamp: new Date().toISOString(), target: { hook: 'wp_daily_sync_task' } },
    { eventId: `fs_${uniq()}`, type: 'file_integrity_scan_completed', category: 'file', timestamp: new Date().toISOString(), metadata: { critical: 0, filesChecked: 412 } },
  ];
  await call('POST', '/api/blackbox/ingest', { site: A.siteId, events: fixEvents }, HA);

  const afterFixInc = (await call('GET', `/api/blackbox/incidents/${incId}`)).body?.incident;
  check('Re-analysis keeps the investigation note', (afterFixInc?.notes ?? []).some((n) => /Asked the team/.test(n.text)), JSON.stringify(afterFixInc?.notes));
  check('Re-analysis keeps the earlier verification run', Number.isFinite(afterFixInc?.verification?.at));

  const v2 = await call('POST', `/api/blackbox/incidents/${incId}/verify`);
  const ver = v2.body?.verification;
  check('After the fix every check resolves', ver?.resolved === ver?.total && ver?.total >= 5, `${ver?.resolved}/${ver?.total}`);
  check('Incident can be marked RESOLVED once verified', ver?.canResolve === true);
  check('Each resolved check names the evidence it used', ver?.results?.every((r) => typeof r.detail === 'string' && r.detail.length > 3));

  const audit = await call('GET', '/api/blackbox/audit?limit=20');
  check('Verification runs are audited', (audit.body?.entries ?? []).some((e) => e.action === 'incident_verification'));

  // ---- rendered page ----
  const page = await call('GET', `/incidents/${incId}`);
  const html = (page.html ?? '').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/<!--[^>]*-->/g, '');
  check('Incident page renders', page.status === 200 && html.includes('<main'), `status ${page.status}`);
  for (const [n, label] of [[1, 'What Happened'], [2, 'How It Probably Happened'], [3, 'What Was Affected'], [4, 'How to Fix It'], [5, 'How to Prevent It Again']]) {
    check(`Section ${n} is "${label}"`, html.includes(`>${n}</span>`) && html.includes(label));
  }
  check('Likely infection path is labelled as likely', html.includes('Likely Infection Path') && html.includes('Likely entry point'));
  check('Reasons block is titled "Why ScanSite thinks this"', html.includes('Why ScanSite thinks this'));
  check('Confidence for the entry point is shown', /Confidence\s*<span[^>]*>\d+%/.test(html));
  check('The nine classifiable paths are listed', html.includes('Infection paths ScanSite can identify') && html.includes('Compromised Admin Account') && html.includes('Brute-force Login') && html.includes('Unknown Entry Point'));
  check('Priority 1 is Secure Access on the page', html.includes('Priority 1 — Secure Access'));
  check('Guided fix button and estimates are present', html.includes('Start Guided Fix') && html.includes('Estimated difficulty') && html.includes('Estimated steps'));
  check('Backup warning precedes the steps', html.includes('Before you start: create a fresh backup'));
  check('Contextual buttons open information, not actions', html.includes('View User') && html.includes('Show Fix Steps') && html.includes('Inspect File') && html.includes('How to Fix') && html.includes('View Cron'));
  check('The page states ScanSite does not change the site', /ScanSite does not change your website/i.test(html));
  check('Affected table reports Unknown rather than "not affected"', html.includes('>Unknown</span>') && !html.includes('Not affected'));
  check('Unmonitored areas are disclosed', html.includes('Not monitored'));
  check('Verify button and remediation status block render', /Re-run verification|Run verification/.test(html) && html.includes('issues resolved'));
  check('The stored verification result is rendered on first paint', /\d+ \/ \d+ issues resolved/.test(html));
  check('Prevention section renders with levels', html.includes('Prevent It Again') && html.includes('>HIGH</span>'));
  check('No certainty about how access was obtained', !/site was infected through|admin password was (cracked|compromised)|confirmed administrator compromise/i.test(html));
  check('No malware/backdoor verdict language', !/backdoor planted|webshell detected|malware confirmed/i.test(html));

  const B = await provision('Plugin Entry Suite', 'https://plugin-entry.example.com');
  const HB = (body) => signed(B.siteId, B.key, body);
  const tb = Date.now();
  await call('POST', '/api/blackbox/ingest', {
    site: B.siteId,
    events: [
      { eventId: `pb_${uniq()}`, type: 'plugin_file_mismatch', category: 'plugin', timestamp: new Date(tb - 12 * MINUTE).toISOString(), target: { plugin: 'woocommerce', name: 'woocommerce' }, changes: { from: '8.1.0' } },
      { eventId: `px_${uniq()}`, type: 'executable_created', category: 'file', timestamp: new Date(tb - 8 * MINUTE).toISOString(), path: '/wp-content/uploads/cache/x.php', target: { path: '/wp-content/uploads/cache/x.php' } },
      { eventId: `pr_${uniq()}`, type: 'unexpected_redirect', category: 'redirect', timestamp: new Date(tb - 4 * MINUTE).toISOString(), target: { name: 'search' } },
    ],
  }, HB);
  const bInc = (await call('GET', `/api/blackbox/incidents?site=${B.siteId}`)).body?.incidents?.[0];
  check('A plugin-mismatch incident gets a plugin entry point', bInc?.entryPoint?.id === 'vulnerable_plugin', bInc?.entryPoint?.id);
  check('Its plan targets the plugin, not an account', (bInc?.remediation?.priorities ?? []).some((p) => p.id === 'integrity' && /woocommerce/.test(JSON.stringify(p.items))), JSON.stringify(bInc?.remediation?.priorities?.map((p) => p.id)));
  check('Its plan does not invent an administrator to secure',
    !(bInc?.remediation?.priorities ?? []).some((p) => p.id === 'secure-access'), JSON.stringify(bInc?.remediation?.priorities?.map((p) => p.id)));

  stub.close();
}

/* ------------------------------------------------------------- cleanup */
for (const id of createdSites) await call('DELETE', `/api/blackbox/sites/${id}?purge=true`);

console.log(`\n${fail === 0 ? '✓' : '✗'} remediation suite: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
