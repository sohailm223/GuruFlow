/**
 * Likely infection path, guided fix, verification and outbound-request guard.
 *
 * Two halves, both against the shipped code:
 *
 *   1. Unit — classifyEntryPoint, the remediation helpers and the netguard
 *      policy matrix imported directly, so a wording, ordering or SSRF-policy
 *      regression fails even when no server is running.
 *   2. Live — the same logic through POST /ingest → GET /incident →
 *      POST /verify and through the rendered incident page.
 *
 *   node tests/blackbox/remediation.mjs
 *
 * Requires a running ScanSite server (see README for the env vars). The live
 * availability checks need SCANSITE_ALLOW_LOCAL_VERIFY=1 on the SERVER, because
 * they point a monitored site at a throwaway local origin; the policy matrix
 * below is what makes that safe to allow in the first place.
 */

import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import { classifyEntryPoint, ENTRY_POINT_TYPES } from '../../src/lib/blackbox/entrypoint.js';
import {
  buildRemediationPlan,
  buildPrevention,
  buildVerificationTargets,
  evaluateVerification,
  verificationStaleness,
  remediationStatusFrom,
  VERIFICATION_STATES,
  REMEDIATION_STATUSES,
} from '../../src/lib/blackbox/remediation.js';
import { guardTarget, addressAllowed, canonicalOrigin, resolveAndGuard, probeStatus } from '../../src/lib/blackbox/netguard.js';

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
const norm = (html = '') => html.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/<!--[^>]*-->/g, '');

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
check('The account label claims possibility, not a proven compromise', admin.label === 'Possible account compromise', admin.label);
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

const adminKnownIp = classifyEntryPoint(adminChainEvents, { knownIps: new Set(['198.51.100.12']) });
check('A previously seen IP is not reported as unknown',
  !adminKnownIp.reasons.some((r) => /does not appear in this site's earlier events/.test(r.text)));
check('Without knownIps no novelty claim is made at all',
  !classifyEntryPoint(adminChainEvents).reasons.some((r) => /does not appear/.test(r.text)));

/* ------------------------------------------------- wording of the classes */
console.log('\nClassification wording (unit)');

const pluginEvents = [
  { eventId: 'p1', timestamp: at(0), type: 'plugin_file_mismatch', category: 'plugin', target: { plugin: 'woocommerce', name: 'woocommerce' }, changes: { from: '8.1.0' } },
  { eventId: 'p2', timestamp: at(5), type: 'executable_created', category: 'file', path: '/wp-content/uploads/cache/x.php' },
  { eventId: 'p3', timestamp: at(7), type: 'cron_added', category: 'cron', target: { hook: 'wc_cache_flush' } },
  { eventId: 'p4', timestamp: at(8), type: 'unexpected_redirect', category: 'redirect', target: { name: 'search' } },
  { eventId: 'p5', timestamp: at(10), type: 'site_error_burst', category: 'availability', metadata: { httpStatus: 500 } },
];
const plugin = classifyEntryPoint(pluginEvents);
check('Plugin file mismatch classifies as a plugin-related entry point', plugin.id === 'vulnerable_plugin', plugin.id);
check('Plugin label does not claim a vulnerability', plugin.label === 'Possible plugin-related entry point', plugin.label);
check('Plugin target carries the plugin name', plugin.target?.kind === 'plugin' && plugin.target?.name === 'woocommerce', JSON.stringify(plugin.target));
check('Plugin chain is Plugin → PHP → Cron → Redirect → Failure',
  plugin.chain.map((c) => c.label).join(' > ') === 'Plugin Activity > Unknown PHP > Cron > Redirect > Website Failure',
  plugin.chain.map((c) => c.label).join(' > '));
check('No vulnerability-database or CVE claim is made', !/known vulnerability|CVE-\d|exploit for/i.test(JSON.stringify(plugin)), plugin.headline);

const themeEntry = classifyEntryPoint([{ eventId: 't1', timestamp: at(0), type: 'theme_file_mismatch', category: 'theme', target: { theme: 'twentytwentyfour' } }]);
check('Theme label does not claim a vulnerability', themeEntry.label === 'Possible theme-related entry point', themeEntry.label);

const appPwd = classifyEntryPoint([
  { eventId: 'a1', timestamp: at(0), type: 'application_password_created', category: 'user', actor: { username: 'editor1', ip: '198.51.100.40' }, target: { name: 'CI Bot' } },
  { eventId: 'a2', timestamp: at(4), type: 'executable_created', category: 'file', path: '/wp-content/uploads/tmp/a.php' },
]);
check('Application-password label does not claim theft', appPwd.label === 'Possible application-password misuse', appPwd.label);
check('Application-password headline does not claim theft', !/stolen|theft|compromised credential/i.test(appPwd.headline), appPwd.headline);

const install = classifyEntryPoint([
  { eventId: 'i1', timestamp: at(0), type: 'plugin_installed', category: 'plugin', target: { name: 'seo-helper' } },
  { eventId: 'i2', timestamp: at(3), type: 'executable_created', category: 'file', path: '/wp-content/uploads/tmp/i.php' },
]);
check('Install label says suspicious, not malicious', install.label === 'Suspicious plugin installation', install.label);
check('An install on its own is NOT called an entry point',
  classifyEntryPoint([{ eventId: 'i9', timestamp: at(0), type: 'plugin_installed', category: 'plugin', target: { name: 'seo-helper' } }]).id !== 'malicious_plugin_install');

const cfg = classifyEntryPoint([{ eventId: 'c1', timestamp: at(0), type: 'siteurl_changed', category: 'config', changes: { to: 'https://evil.example' } }]);
check('A site URL change classifies as configuration hijack', cfg.id === 'configuration_hijack', cfg.id);
check('The configuration label does not assert hijacking', cfg.label === 'Configuration or redirect change', cfg.label);
check('The configuration chain step says what changed, not who did it',
  cfg.chain[0].label === 'Configuration Changed' && !/hijack/i.test(cfg.chain[0].label), cfg.chain[0].label);

const brute = classifyEntryPoint([
  { eventId: 'b1', timestamp: at(0), type: 'login_failed_burst', category: 'auth', count: 42, target: { username: 'admin' }, metadata: { windowMinutes: 5, ipCount: 3 } },
  { eventId: 'b2', timestamp: at(6), type: 'login_success', category: 'auth', actor: { username: 'admin', ip: '198.51.100.9' } },
]);
check('A failed-login burst followed by a success classifies as brute force', brute.id === 'brute_force_login', brute.id);
check('Brute-force reasons quote the attempt count', brute.reasons.some((r) => /42 failed logins/.test(r.text)), JSON.stringify(brute.reasons));

const uploadOnly = classifyEntryPoint([{ eventId: 'x1', timestamp: at(0), type: 'executable_created', category: 'file', path: '/wp-content/uploads/2026/03/shell.php' }]);
check('A lone executable in uploads is an unexpected file upload', uploadOnly.id === 'unexpected_file_upload', uploadOnly.id);

check('The published class list carries no overclaiming labels',
  !ENTRY_POINT_TYPES.some((t) => /\b(vulnerable|malicious|stolen|exploit|hijack)\b/i.test(t.label)),
  JSON.stringify(ENTRY_POINT_TYPES.map((t) => t.label)));
check('A label may only mention compromise when it is hedged',
  ENTRY_POINT_TYPES.filter((t) => /compromis/i.test(t.label)).every((t) => /^possible /i.test(t.label)),
  JSON.stringify(ENTRY_POINT_TYPES.filter((t) => /compromis/i.test(t.label)).map((t) => t.label)));
// The module header deliberately names the old labels as contrast, so strip
// comments before scanning: what matters is that no code path emits them.
const entrySource = fs
  .readFileSync(new URL('../../src/lib/blackbox/entrypoint.js', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
check('No code path still emits an overclaiming label',
  !/Compromised Admin Account|Configuration Hijack|Vulnerable (Plugin|Theme)|Malicious Plugin|Stolen Application/i.test(entrySource));
check('No classifier output claims vulnerability, malice or theft',
  ![plugin, themeEntry, appPwd, install].some((e) => /vulnerable|malicious|stolen/i.test(`${e.label} ${e.headline}`)));

/* --------------------------------------------- Unknown Entry Point stays */
console.log('\nUnknown Entry Point (unit)');

const nothing = classifyEntryPoint([{ eventId: 'n1', timestamp: at(0), type: 'site_inventory', category: 'site', metadata: { plugins: 12 } }]);
check('Unrelated activity yields Unknown Entry Point, not a guess', nothing.id === 'unknown' && nothing.chain.length === 0, nothing.id);
check('Unknown entry point reports zero confidence and no target', nothing.confidence === 0 && nothing.confidenceLabel === 'Uncertain' && nothing.target === null);
check('Unknown entry point explains why rather than guessing', nothing.reasons.length >= 1 && nothing.reasons[0].text.length > 10, nothing.reasons[0]?.text);
check('Unknown Entry Point is a published classification', ENTRY_POINT_TYPES.some((t) => t.id === 'unknown' && t.label === 'Unknown Entry Point'));
check('A lone login_success never becomes an entry point',
  classifyEntryPoint([{ eventId: 'n2', timestamp: at(0), type: 'login_success', category: 'auth', actor: { username: 'alice' } }]).id === 'unknown');

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
 * 2. UNIT — fix plan and evidence citations
 * ========================================================================== */
console.log('\nRemediation plan (unit)');

const planIncident = { entryPoint: admin, events: adminChainEvents, startedAt: at(0) };
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

const accountItems = plan.priorities.find((p) => p.id === 'secure-access').items;
check('Every account step cites its evidence event',
  accountItems.every((i) => i.evidence?.eventId === 'u1'), JSON.stringify(accountItems.map((i) => i.evidence?.eventId)));
check('The account reason explains the timing that caused it',
  /6 minutes before a suspicious executable/.test(accountItems[0].evidence.reason), accountItems[0].evidence.reason);
check('The file step cites the event that created the file',
  plan.priorities.find((p) => p.id === 'suspicious-files').items.every((i) => i.evidence?.eventId === 'u2'));
check('The cron step cites the event that registered the hook',
  plan.priorities.find((p) => p.id === 'persistence').items.every((i) => i.evidence?.eventId === 'u3'));
check('Guided steps carry the same evidence', plan.guided.filter((s) => s.subject).every((s) => s.evidence?.eventId));
check('Every target-derived checklist line has a reason',
  plan.priorities.flatMap((p) => p.items).filter((i) => i.evidence).every((i) => i.evidence.reason?.length > 10));

const prevention = buildPrevention(planIncident);
check('Prevention suggests 2FA when an account is involved', prevention.some((p) => /two-factor/i.test(p.text)));
check('Prevention items carry HIGH/MEDIUM/LOW levels', prevention.every((p) => ['HIGH', 'MEDIUM', 'LOW'].includes(p.level)));
check('Prevention items cite evidence where the incident supplies it', prevention.some((p) => p.evidence?.eventId));

/* --------------------------- evidence must match the advice it is attached to */
console.log('\nEvidence attribution (unit)');

// A plugin event, a config event and an application-password event, each with a
// distinct id, so a recommendation citing the wrong one is visible.
const attributionEvents = [
  { eventId: 'att_plugin', timestamp: at(0), type: 'plugin_updated', category: 'plugin', target: { plugin: 'woocommerce' }, changes: { from: '8.1.0' } },
  { eventId: 'att_theme', timestamp: at(1), type: 'theme_updated', category: 'theme', target: { theme: 'astra' } },
  { eventId: 'att_config', timestamp: at(2), type: 'siteurl_changed', category: 'config', changes: { to: 'https://evil.example' } },
  { eventId: 'att_apppw', timestamp: at(3), type: 'application_password_created', category: 'user', target: { name: 'CI Bot' }, actor: { username: 'editor1' } },
  { eventId: 'att_acct', timestamp: at(4), type: 'administrator_created', category: 'user', target: { username: 'mallory' } },
  { eventId: 'att_file', timestamp: at(10), type: 'executable_created', category: 'file', path: '/wp-content/uploads/cache/z.php' },
];
const attributionIncident = { startedAt: at(0), events: attributionEvents, entryPoint: null };
const attributed = buildPrevention(attributionIncident);
const citeFor = (needle) => attributed.find((p) => p.text.includes(needle))?.evidence?.eventId ?? null;

check('Plugin advice cites the plugin event, not a config event', citeFor('Update outdated plugins') === 'att_plugin', citeFor('Update outdated plugins'));
check('Configuration advice cites the configuration event', citeFor('read-only for the web server') === 'att_config', citeFor('read-only for the web server'));
check('Application-password advice cites the application-password event', citeFor('Review application passwords') === 'att_apppw', citeFor('Review application passwords'));
check('Administrator advice cites the account event', citeFor('two-factor') === 'att_acct', citeFor('two-factor'));
check('Uploads advice cites the file event', citeFor('uploads directory') === 'att_file', citeFor('uploads directory'));
check('Every cited event exists in the incident',
  attributed.filter((p) => p.evidence?.eventId).every((p) => attributionEvents.some((e) => e.eventId === p.evidence.eventId)),
  JSON.stringify(attributed.map((p) => p.evidence?.eventId)));
check('Generic advice that no event caused cites nothing',
  attributed.filter((p) => /backup|session lifetime/i.test(p.text)).every((p) => p.evidence?.eventId == null || p.evidence.eventId === 'att_acct'));

const attributionPlan = buildRemediationPlan(attributionIncident);
const reinstall = attributionPlan.priorities.find((p) => p.id === 'integrity')?.items.find((i) => i.id === 'reinstall-plugin');
check('The reinstall step cites the plugin it names', reinstall?.evidence?.eventId === 'att_plugin', reinstall?.evidence?.eventId);
// The plan and the prevention list give the same advice in two places; they
// must not disagree about what caused it.
const smtpIncident = { startedAt: at(0), entryPoint: null, events: [
  { eventId: 'sm_acct', timestamp: at(0), type: 'administrator_created', category: 'user', target: { username: 'mallory' } },
  { eventId: 'sm_apppw', timestamp: at(1), type: 'application_password_created', category: 'user', target: { name: 'CI Bot' }, actor: { username: 'editor1' } },
  { eventId: 'sm_config', timestamp: at(2), type: 'siteurl_changed', category: 'config', changes: { to: 'https://evil.example' } },
  { eventId: 'sm_smtp', timestamp: at(3), type: 'smtp_setting_changed', category: 'config', changes: { to: 'smtp.relay.example' } },
] };
const smtpPlan = buildRemediationPlan(smtpIncident);
const planItem = (id) => smtpPlan.priorities.flatMap((p) => p.items).find((i) => i.id === id);

check('Plan application-password step cites the application-password event', planItem('review-app-passwords')?.evidence?.eventId === 'sm_apppw', planItem('review-app-passwords')?.evidence?.eventId);
check('Plan SMTP step cites the mail-settings event', planItem('check-smtp')?.evidence?.eventId === 'sm_smtp', planItem('check-smtp')?.evidence?.eventId);
check('Plan account steps still cite the account event', planItem('reset-admin-passwords')?.evidence?.eventId === 'sm_acct', planItem('reset-admin-passwords')?.evidence?.eventId);
check('Plan and prevention cite the same event for the same advice',
  planItem('review-app-passwords')?.evidence?.eventId === buildPrevention(smtpIncident).find((p) => /Review application passwords/.test(p.text))?.evidence?.eventId);
check('Advice with no specific event falls back to its priority, not to nothing',
  (() => {
    const bare = buildRemediationPlan({ startedAt: at(0), entryPoint: null, events: [{ eventId: 'only_acct', timestamp: at(0), type: 'administrator_created', category: 'user', target: { username: 'mallory' } }] });
    const it = bare.priorities.flatMap((p) => p.items).find((i) => i.id === 'review-app-passwords');
    return it?.evidence?.eventId === 'only_acct';
  })());

check('Every evidence-citing checklist line points at a real event',
  attributionPlan.priorities.flatMap((p) => p.items).filter((i) => i.evidence?.eventId)
    .every((i) => attributionEvents.some((e) => e.eventId === i.evidence.eventId)));
check('Uploads hardening only appears when an uploads file is involved',
  prevention.some((p) => /uploads/i.test(p.text)) && buildPrevention({ events: [], entryPoint: null }).every((p) => !/uploads/i.test(p.text)));

/* ========================================================================== *
 * 3. UNIT — verification states: strong vs weak evidence
 * ========================================================================== */
console.log('\nVerification semantics (unit)');

check('Five result states are defined',
  VERIFICATION_STATES.join(',') === 'verified_resolved,likely_resolved,still_present,not_verified,not_monitored', VERIFICATION_STATES.join(','));
check('Four remediation statuses are defined',
  REMEDIATION_STATUSES.join(',') === 'not_started,in_progress,partially_resolved,verified', REMEDIATION_STATUSES.join(','));

const before = evaluateVerification(planIncident, { events: [], files: [], siteStatus: { ok: true, status: 200 } });
check('Checks cover account, file, cron, integrity and availability',
  ['account', 'file', 'cron', 'integrity', 'availability'].every((k) => before.results.some((r) => r.kind === k)),
  before.results.map((r) => r.kind).join(','));
check('With no remediation evidence only the reachable-site check passes',
  before.resolved === 1 && before.verified === 1 && before.likely === 0 && before.notVerified === 4 && before.canResolve === false,
  `${before.resolved}/${before.total} ${before.results.map((r) => `${r.kind}=${r.state}`).join(' ')}`);
check('An explicit removal event is strong evidence',
  evaluateVerification(planIncident, {
    events: [{ eventId: 'g1', timestamp: at(40), type: 'user_deleted', category: 'user', target: { username: 'mallory' } }],
    siteStatus: null,
  }).results[0].state === 'verified_resolved');
check('Strong results are labelled strong',
  evaluateVerification(planIncident, {
    events: [{ eventId: 'g1', timestamp: at(40), type: 'user_deleted', category: 'user', target: { username: 'mallory' } }],
  }).results[0].strength === 'strong');

const snapshot = (users) => ({ eventId: 'snap1', timestamp: at(50), type: 'users_snapshot', category: 'user', metadata: { total: users.length, users } });
const snapWithout = evaluateVerification(planIncident, { events: [snapshot([{ username: 'alice', isAdmin: true }])], siteStatus: null });
check('Absence from a later snapshot is only LIKELY resolved', snapWithout.results[0].state === 'likely_resolved', snapWithout.results[0].state);
check('Snapshot-based results are labelled weak evidence', snapWithout.results[0].strength === 'weak' && snapWithout.likely === 1 && snapWithout.verified === 0);
check('A snapshot showing no admin role is still only likely resolved',
  evaluateVerification(planIncident, { events: [snapshot([{ username: 'mallory', isAdmin: false }])], siteStatus: null }).results[0].state === 'likely_resolved');
check('A snapshot showing the admin still present is still_present',
  evaluateVerification(planIncident, { events: [snapshot([{ username: 'mallory', isAdmin: true }])], siteStatus: null }).results[0].state === 'still_present');
check('Strong evidence outranks an older snapshot',
  evaluateVerification(planIncident, {
    events: [snapshot([{ username: 'mallory', isAdmin: true }]), { eventId: 'g1', timestamp: at(60), type: 'user_deleted', category: 'user', target: { username: 'mallory' } }],
    siteStatus: null,
  }).results[0].state === 'verified_resolved');
check('A clean aggregate scan without a deletion event is only likely resolved',
  evaluateVerification(planIncident, {
    events: [{ eventId: 'g4', timestamp: at(60), type: 'file_integrity_scan_completed', category: 'file', metadata: { critical: 0, suspicious: 0, filesChecked: 412 } }],
    files: [],
    siteStatus: null,
  }).results.find((r) => r.kind === 'file').state === 'likely_resolved');
check('An unavailable site is not counted as a pass',
  evaluateVerification(planIncident, { events: [], siteStatus: { ok: false, status: 302 } }).results.find((r) => r.kind === 'availability').state === 'still_present');
check('An unreachable site is reported as not verified, not failed',
  evaluateVerification(planIncident, { events: [], siteStatus: { ok: false, error: 'unreachable' } }).results.find((r) => r.kind === 'availability').state === 'not_verified');
check('A policy-blocked website check is not_monitored, not a failure',
  evaluateVerification(planIncident, { events: [], siteStatus: { blocked: 'link-local addresses are always blocked' } }).results.find((r) => r.kind === 'availability').state === 'not_monitored');
check('Unmonitored checks are excluded from the total',
  (() => {
    const v = evaluateVerification({ ...planIncident, events: [...planIncident.events, { eventId: 'cfg1', timestamp: at(2), type: 'siteurl_changed', category: 'config', changes: { to: 'https://evil.example' } }] }, { events: [], siteStatus: { ok: true, status: 200 } });
    return v.results.some((r) => r.state === 'not_monitored') && v.total === v.results.length - v.notMonitored;
  })());

const fixEvents = [
  { eventId: 'g1', timestamp: at(60), type: 'user_deleted', category: 'user', target: { username: 'mallory' } },
  { eventId: 'g2', timestamp: at(61), type: 'file_deleted', category: 'file', path: '/wp-content/uploads/cache/z.php' },
  { eventId: 'g3', timestamp: at(62), type: 'cron_removed', category: 'cron', target: { hook: 'wp_daily_sync_task' } },
  { eventId: 'g4', timestamp: at(63), type: 'file_integrity_scan_completed', category: 'file', metadata: { critical: 0, filesChecked: 412 } },
];
const fixed = evaluateVerification(planIncident, { events: fixEvents, files: [], siteStatus: { ok: true, status: 200 } });
check('Account, file, cron and integrity resolve on matching evidence', fixed.resolved === fixed.total, `${fixed.resolved}/${fixed.total}`);
check('All strong evidence reports verified, not merely likely', fixed.verified === fixed.total && fixed.likely === 0, `${fixed.verified}/${fixed.likely}`);
check('Incident can be marked resolved once every check passes', fixed.canResolve === true);
check('A verification records verifiedAt', Number.isFinite(fixed.verifiedAt));
check('A file that still exists is still_present',
  evaluateVerification(planIncident, { events: [], files: [{ relativePath: 'wp-content/uploads/cache/z.php', integrityStatus: 'modified' }], siteStatus: { ok: true, status: 200 } })
    .results.find((r) => r.kind === 'file').state === 'still_present');
check('A scan that still reports critical files is still_present',
  evaluateVerification(planIncident, { events: [{ eventId: 'f5', timestamp: at(60), type: 'file_integrity_scan_completed', metadata: { critical: 2 } }], siteStatus: { ok: true, status: 200 } })
    .results.find((r) => r.kind === 'integrity').state === 'still_present');
check('A demotion away from administrator counts as securing the account',
  evaluateVerification(planIncident, { events: [{ eventId: 'f6', timestamp: at(60), type: 'user_role_changed', category: 'user', target: { username: 'mallory' }, changes: { to: 'subscriber' } }], siteStatus: null }).results[0].state === 'verified_resolved');

// Remediation events are normally grouped INTO the incident they clean up
// (same account, same path, same hook). The checks must still see them.
const merged = evaluateVerification(
  { startedAt: at(0), entryPoint: admin, events: [...adminChainEvents, ...fixEvents] },
  { events: fixEvents, files: [], siteStatus: { ok: true, status: 200 } }
);
check('Fixes recorded inside the incident window still count', merged.resolved === merged.total, `${merged.resolved}/${merged.total} ${merged.results.map((r) => `${r.kind}=${r.state}`).join(' ')}`);
check('A deletion that predates the file does not count as a fix',
  evaluateVerification(
    { startedAt: at(0), entryPoint: admin, events: [...adminChainEvents, { eventId: 'g9', timestamp: at(1), type: 'file_deleted', category: 'file', path: '/wp-content/uploads/cache/z.php' }] },
    { events: [{ eventId: 'g9', timestamp: at(1), type: 'file_deleted', category: 'file', path: '/wp-content/uploads/cache/z.php' }], siteStatus: null }
  ).results.find((r) => r.kind === 'file').state === 'not_verified');
check('Each result names the evidence it used', fixed.results.every((r) => typeof r.detail === 'string' && r.detail.length > 5));

/* ------------------------------------------- one source of truth for checks */
console.log('\nVerification check list (unit)');

const configIncident = { ...planIncident, events: [...planIncident.events, { eventId: 'cfg1', timestamp: at(2), type: 'siteurl_changed', category: 'config', changes: { to: 'https://evil.example' } }] };
const declared = buildVerificationTargets(configIncident);
const evaluated = evaluateVerification(configIncident, { events: [], files: [], siteStatus: { ok: true, status: 200 } });

check('Every declared check is actually evaluated',
  declared.every((c) => evaluated.results.some((r) => r.id === c.id)),
  declared.filter((c) => !evaluated.results.some((r) => r.id === c.id)).map((c) => c.id).join(','));
check('No evaluated check is missing from the declared list',
  evaluated.results.every((r) => declared.some((c) => c.id === r.id)),
  evaluated.results.filter((r) => !declared.some((c) => c.id === r.id)).map((r) => r.id).join(','));
check('The declared list has no duplicate ids', new Set(declared.map((c) => c.id)).size === declared.length);
check('Every result explains the rule that decided it',
  evaluated.results.every((r) => typeof r.how === 'string' && r.how.length > 15),
  JSON.stringify(evaluated.results.filter((r) => !r.how).map((r) => r.id)));
check('The DNS check says plainly that it is not monitored',
  evaluated.results.find((r) => r.kind === 'dns')?.how.includes('does not monitor DNS'),
  evaluated.results.find((r) => r.kind === 'dns')?.how);

/* ------------------------------------------------- remediation status */
console.log('\nRemediation status (unit)');
check('No checks means not_started', remediationStatusFrom({ resolved: 0, total: 0, stillPresent: 0 }) === 'not_started');
check('A run with nothing resolved is in_progress', remediationStatusFrom({ resolved: 0, total: 4, stillPresent: 1 }) === 'in_progress');
check('Some resolved is partially_resolved', remediationStatusFrom({ resolved: 2, total: 4, stillPresent: 1 }) === 'partially_resolved');
check('All resolved is verified', remediationStatusFrom({ resolved: 4, total: 4, stillPresent: 0 }) === 'verified');
check('Anything still present blocks verified', remediationStatusFrom({ resolved: 4, total: 4, stillPresent: 1 }) !== 'verified');
check('Remediation status is derived and stored on the verification', fixed.remediationStatus === 'verified');

/* ------------------------------------------------------- staleness */
console.log('\nVerification staleness (unit)');
const verifiedIncident = { ...planIncident, verification: { ...fixed } };
const reappeared = verificationStaleness(verifiedIncident, [
  { eventId: 's1', timestamp: fixed.verifiedAt + 60_000, type: 'executable_created', category: 'file', path: '/wp-content/uploads/cache/z.php' },
]);
check('The same path reappearing invalidates the verification', reappeared.stale === true, JSON.stringify(reappeared));
check('Staleness names the reason and the event', /appeared or changed again/.test(reappeared.reason ?? '') && reappeared.eventId === 's1', reappeared.reason);
check('New activity on the flagged account invalidates the verification',
  verificationStaleness(verifiedIncident, [{ eventId: 's2', timestamp: fixed.verifiedAt + 60_000, type: 'administrator_created', category: 'user', target: { username: 'mallory' } }]).stale === true);
check('A re-registered cron hook invalidates the verification',
  verificationStaleness(verifiedIncident, [{ eventId: 's3', timestamp: fixed.verifiedAt + 60_000, type: 'cron_added', category: 'cron', target: { hook: 'wp_daily_sync_task' } }]).stale === true);
check('A new scan reporting critical files invalidates the verification',
  verificationStaleness(verifiedIncident, [{ eventId: 's4', timestamp: fixed.verifiedAt + 60_000, type: 'file_integrity_scan_completed', category: 'file', metadata: { critical: 3 } }]).stale === true);
check('Unrelated new events do NOT invalidate the verification',
  verificationStaleness(verifiedIncident, [
    { eventId: 's5', timestamp: fixed.verifiedAt + 60_000, type: 'login_success', category: 'auth', actor: { username: 'alice' } },
    { eventId: 's6', timestamp: fixed.verifiedAt + 60_000, type: 'plugin_activated', category: 'plugin', target: { plugin: 'woocommerce' } },
  ]).stale === false);
check('Events from before the verification do not invalidate it',
  verificationStaleness(verifiedIncident, [{ eventId: 's7', timestamp: fixed.verifiedAt - 60_000, type: 'executable_created', category: 'file', path: '/wp-content/uploads/cache/z.php' }]).stale === false);
check('An incident with no verification cannot be stale', verificationStaleness(planIncident, [{ eventId: 's8', timestamp: Date.now(), type: 'user_deleted' }]).stale === false);

/* ========================================================================== *
 * 4. UNIT — outbound request guard (SSRF)
 * ========================================================================== */
console.log('\nOutbound verification guard (unit)');

const HATCH = 'SCANSITE_ALLOW_LOCAL_VERIFY';
const previousHatch = process.env[HATCH];

// Production posture: no escape hatch.
delete process.env[HATCH];
check('Cloud metadata IP is blocked', guardTarget('http://169.254.169.254/latest/meta-data/').ok === false, JSON.stringify(guardTarget('http://169.254.169.254/')));
check('Link-local range is blocked', guardTarget('http://169.254.10.10/').ok === false);
check('IPv6 link-local is blocked', guardTarget('http://[fe80::1]/').ok === false);
check('Loopback IPv4 is blocked', guardTarget('http://127.0.0.1:8080/admin').ok === false);
check('Loopback IPv6 is blocked', guardTarget('http://[::1]/').ok === false);
check('"localhost" is blocked', guardTarget('http://localhost/').ok === false);
check('A localhost subdomain is blocked', guardTarget('http://foo.localhost/').ok === false);
check('Private 10/8 is blocked', guardTarget('http://10.0.0.5/').ok === false);
check('Private 172.16/12 is blocked', guardTarget('http://172.16.4.4/').ok === false);
check('Private 192.168/16 is blocked', guardTarget('http://192.168.1.1/').ok === false);
check('IPv6 unique-local is blocked', guardTarget('http://[fd00::1]/').ok === false);
check('CGNAT space is blocked', guardTarget('http://100.64.0.1/').ok === false);
check('Unspecified address is blocked', guardTarget('http://0.0.0.0/').ok === false);
check('Broadcast address is blocked', guardTarget('http://255.255.255.255/').ok === false);
check('Multicast is blocked', guardTarget('http://224.0.0.1/').ok === false);
check('Internal .local names are blocked', guardTarget('http://intranet.local/').ok === false);
check('file: URLs are rejected', guardTarget('file:///etc/passwd').ok === false);
check('gopher: URLs are rejected', guardTarget('gopher://127.0.0.1:6379/').ok === false);
check('data: URLs are rejected', guardTarget('data:text/html,<script>1</script>').ok === false);
check('An IPv4-mapped IPv6 loopback is blocked', addressAllowed('::ffff:127.0.0.1').ok === false);
check('A registered external HTTPS site is allowed', guardTarget('https://example.com/').ok === true, JSON.stringify(guardTarget('https://example.com/')));
check('A registered external HTTP site is allowed', guardTarget('http://93.184.216.34/').ok === true);
check('Blocked reasons are explicit', /blocked/.test(guardTarget('http://127.0.0.1/').reason ?? ''), guardTarget('http://127.0.0.1/').reason);

// Explicit local-development hatch: loopback and private only.
process.env[HATCH] = '1';
check('The local hatch unlocks loopback for development', guardTarget('http://127.0.0.1:3000/').ok === true);
check('The local hatch unlocks private ranges', guardTarget('http://192.168.1.10/').ok === true);
check('The local hatch never unlocks cloud metadata', guardTarget('http://169.254.169.254/').ok === false);
check('The local hatch never unlocks link-local', guardTarget('http://169.254.1.1/').ok === false);
check('The local hatch never unlocks CGNAT', guardTarget('http://100.64.0.1/').ok === false);
check('The local hatch never unlocks file: URLs', guardTarget('file:///etc/passwd').ok === false);
if (previousHatch === undefined) delete process.env[HATCH];
else process.env[HATCH] = previousHatch;

check('canonicalOrigin strips path and query', canonicalOrigin('https://site.example.com/wp-login.php?redirect=1') === 'https://site.example.com', canonicalOrigin('https://site.example.com/wp-login.php?x=1'));
check('canonicalOrigin keeps the port', canonicalOrigin('http://127.0.0.1:8080/a/b') === 'http://127.0.0.1:8080');
check('canonicalOrigin rejects non-HTTP schemes', canonicalOrigin('file:///etc/passwd') === null);
check('canonicalOrigin rejects garbage', canonicalOrigin('not a url') === null);

delete process.env[HATCH];
const dnsBlocked = await resolveAndGuard('localhost');
check('DNS resolution of localhost is refused without the hatch', dnsBlocked.ok === false && /blocked/.test(dnsBlocked.reason ?? ''), JSON.stringify(dnsBlocked));
const probeBlocked = await probeStatus('http://169.254.169.254/latest/meta-data/');
check('probeStatus refuses a blocked target without making a request', probeBlocked.ok === false && Boolean(probeBlocked.blocked), JSON.stringify(probeBlocked));
check('probeStatus refuses a non-HTTP scheme', (await probeStatus('file:///etc/passwd')).blocked !== undefined);
if (previousHatch === undefined) delete process.env[HATCH];
else process.env[HATCH] = previousHatch;

/* ========================================================================== *
 * 5. LIVE — through the API and the rendered page
 * ========================================================================== */
console.log('\nLive: incident, verification round trip, staleness, page markup');

if (!ADMIN_COOKIE) {
  console.log('  ! Not logged in — skipping the live half');
} else {
  const SECRET_BODY_TOKEN = `scansite-body-token-${uniq()}`;

  // A stub origin so the availability check has a real HTTP 200 to find. It
  // also returns a large body carrying a token, so the suite can prove the body
  // is never read back into the response.
  const stub = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.write('X'.repeat(512 * 1024));
    res.end(SECRET_BODY_TOKEN);
  });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  const stubUrl = `http://127.0.0.1:${stub.address().port}`;

  // A stub that redirects into the cloud metadata range.
  const redirectStub = http.createServer((_req, res) => {
    res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
    res.end('redirecting');
  });
  await new Promise((r) => redirectStub.listen(0, '127.0.0.1', r));
  const redirectUrl = `http://127.0.0.1:${redirectStub.address().port}`;

  const A = await provision('Remediation Suite', stubUrl);
  const HA = (body) => signed(A.siteId, A.key, body);

  const t0 = Date.now();
  const seeded = [
    { eventId: `ra_${uniq()}`, type: 'administrator_created', category: 'user', timestamp: new Date(t0 - 20 * MINUTE).toISOString(), actor: { username: 'support_wp', ip: '198.51.100.12' }, target: { username: 'support_wp' }, changes: { to: 'administrator' } },
    { eventId: `re_${uniq()}`, type: 'executable_created', category: 'file', timestamp: new Date(t0 - 14 * MINUTE).toISOString(), actor: { username: 'support_wp', ip: '198.51.100.12' }, path: '/wp-content/uploads/cache/z.php', target: { name: 'z.php', path: '/wp-content/uploads/cache/z.php' } },
    { eventId: `rc_${uniq()}`, type: 'cron_added', category: 'cron', timestamp: new Date(t0 - 10 * MINUTE).toISOString(), actor: { username: 'support_wp', ip: '198.51.100.12' }, target: { hook: 'wp_daily_sync_task' } },
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
  check('Stored plan items cite their evidence events',
    inc?.remediation?.priorities?.find((p) => p.id === 'secure-access')?.items?.every((i) => i.evidence?.eventId === seeded[0].eventId),
    JSON.stringify(inc?.remediation?.priorities?.find((p) => p.id === 'secure-access')?.items?.map((i) => i.evidence?.eventId)));
  check('A new incident starts with remediation not_started',
    (await call('GET', `/api/blackbox/incidents/${incId}/verify`)).body?.remediationStatus === 'not_started');

  const v1 = await call('POST', `/api/blackbox/incidents/${incId}/verify`);
  check('POST /verify returns 200 with results', v1.status === 200 && Array.isArray(v1.body?.verification?.results), `got ${v1.status}`);
  check('Before the fix nothing is claimed as fixed', v1.body?.verification?.canResolve === false, JSON.stringify(v1.body?.verification?.results?.map((r) => `${r.kind}:${r.state}`)));
  check('The website check really fetched the site (HTTP 200)',
    v1.body?.verification?.results?.find((r) => r.kind === 'availability')?.state === 'verified_resolved',
    v1.body?.verification?.results?.find((r) => r.kind === 'availability')?.detail);
  check('The response body is never returned to the dashboard',
    !JSON.stringify(v1.body).includes(SECRET_BODY_TOKEN));
  check('A first run with the site reachable is partially resolved',
    v1.body?.verification?.remediationStatus === 'partially_resolved' && v1.body?.verification?.resolved === 1,
    `${v1.body?.verification?.remediationStatus} ${v1.body?.verification?.resolved}/${v1.body?.verification?.total}`);

  const afterV1 = await call('GET', `/api/blackbox/incidents/${incId}`);
  check('Verification is persisted on the incident', Number.isFinite(afterV1.body?.incident?.verification?.verifiedAt));
  check('Remediation status is persisted separately from incident status',
    afterV1.body?.incident?.remediationStatus === 'partially_resolved' && afterV1.body?.incident?.status === 'new',
    `${afterV1.body?.incident?.remediationStatus} / ${afterV1.body?.incident?.status}`);

  // Operator-entered data must survive the re-analysis the next ingest triggers.
  await call('PATCH', `/api/blackbox/incidents/${incId}`, { note: 'Asked the team about support_wp' });
  await call('POST', '/api/blackbox/ingest', {
    site: A.siteId,
    events: [
      { eventId: `fa_${uniq()}`, type: 'user_deleted', category: 'user', timestamp: new Date().toISOString(), target: { username: 'support_wp' } },
      { eventId: `ff_${uniq()}`, type: 'file_deleted', category: 'file', timestamp: new Date().toISOString(), path: '/wp-content/uploads/cache/z.php' },
      { eventId: `fc_${uniq()}`, type: 'cron_removed', category: 'cron', timestamp: new Date().toISOString(), target: { hook: 'wp_daily_sync_task' } },
      { eventId: `fs_${uniq()}`, type: 'file_integrity_scan_completed', category: 'file', timestamp: new Date().toISOString(), metadata: { critical: 0, suspicious: 0, filesChecked: 412 } },
    ],
  }, HA);

  const afterFixInc = (await call('GET', `/api/blackbox/incidents/${incId}`)).body?.incident;
  check('Re-analysis keeps the investigation note', (afterFixInc?.notes ?? []).some((n) => /Asked the team/.test(n.text)), JSON.stringify(afterFixInc?.notes));
  check('Re-analysis keeps the earlier verification run', Number.isFinite(afterFixInc?.verification?.verifiedAt));
  check('Re-analysis keeps the remediation status', afterFixInc?.remediationStatus === 'partially_resolved', afterFixInc?.remediationStatus);
  check('Unrelated fix activity does not mark the verification stale', afterFixInc?.verification?.stale === false);

  const v2 = await call('POST', `/api/blackbox/incidents/${incId}/verify`);
  const ver = v2.body?.verification;
  check('After the fix every check resolves', ver?.resolved === ver?.total && ver?.total >= 5, `${ver?.resolved}/${ver?.total}`);
  check('Remediation status becomes verified', v2.body?.incident?.remediationStatus === 'verified', v2.body?.incident?.remediationStatus);
  check('Incident status is untouched by verification', v2.body?.incident?.status === 'new', v2.body?.incident?.status);
  check('Incident can be marked RESOLVED once verified', ver?.canResolve === true);
  check('Every resolved check is strong evidence', ver?.verified === ver?.total, `${ver?.verified}/${ver?.total}`);

  const audit = await call('GET', '/api/blackbox/audit?limit=20');
  check('Verification runs are audited', (audit.body?.entries ?? []).some((e) => e.action === 'incident_verification'));

  // ---- the verified file comes back ----
  await call('POST', '/api/blackbox/ingest', {
    site: A.siteId,
    events: [{ eventId: `rb_${uniq()}`, type: 'executable_created', category: 'file', timestamp: new Date().toISOString(), path: '/wp-content/uploads/cache/z.php', target: { path: '/wp-content/uploads/cache/z.php' } }],
  }, HA);
  const staleInc = (await call('GET', `/api/blackbox/incidents/${incId}`)).body?.incident;
  check('The same path reappearing marks the verification stale', staleInc?.verification?.stale === true, JSON.stringify(staleInc?.verification?.staleReason));
  check('Staleness explains what happened', /appeared or changed again/.test(staleInc?.verification?.staleReason ?? ''), staleInc?.verification?.staleReason);
  check('A verified cleanup is no longer reported as verified', staleInc?.remediationStatus === 'in_progress', staleInc?.remediationStatus);

  // ---- rendered page ----
  const page = await call('GET', `/incidents/${incId}`);
  const html = norm(page.html ?? '');
  check('Incident page renders', page.status === 200 && html.includes('<main'), `status ${page.status}`);
  for (const [n, label] of [[1, 'What Happened'], [2, 'How It Probably Happened'], [3, 'What Was Affected'], [4, 'How to Fix It'], [5, 'How to Prevent It Again']]) {
    check(`Section ${n} is "${label}"`, html.includes(`>${n}</span>`) && html.includes(label));
  }
  check('Likely infection path is labelled as likely', html.includes('Likely Infection Path') && html.includes('Likely entry point'));
  check('Reasons block is titled "Why ScanSite thinks this"', html.includes('Why ScanSite thinks this'));
  check('Confidence for the entry point is shown', /Confidence\s*<span[^>]*>\d+%/.test(html));
  check('The classifiable paths are listed with the new wording',
    html.includes('Infection paths ScanSite can identify') && html.includes('Possible plugin-related entry point') && html.includes('Suspicious plugin installation') && html.includes('Possible application-password misuse'));
  check('The renamed account and configuration labels reach the page',
    html.includes('Possible account compromise') && html.includes('Configuration or redirect change'));
  check('No overclaiming label reaches the page',
    !/Vulnerable Plugin|Vulnerable Theme|Malicious Plugin|Stolen Application Password|Compromised Admin Account|Configuration Hijack/.test(html));
  check('Priority 1 is Secure Access on the page', html.includes('Priority 1 — Secure Access'));
  check('The page cites the event behind each recommendation', html.includes('Reason:') && html.includes(seeded[0].eventId));
  check('Guided fix button and estimates are present', html.includes('Start Guided Fix') && html.includes('Estimated difficulty') && html.includes('Estimated steps'));
  check('Backup warning precedes the steps', html.includes('Before you start: create a fresh backup'));
  check('Contextual buttons open information, not actions', html.includes('View User') && html.includes('Show Fix Steps') && html.includes('Inspect File') && html.includes('How to Fix') && html.includes('View Cron'));
  check('The page states ScanSite does not change the site', /ScanSite does not change your website/i.test(html));
  check('Affected table reports Unknown rather than "not affected"', html.includes('>Unknown</span>') && !html.includes('Not affected'));
  check('Unmonitored areas are disclosed', html.includes('Not monitored'));
  check('Verify button and remediation status block render', /Re-run verification|Run verification/.test(html) && html.includes('verification checks resolved'));
  check('Remediation status is shown separately from incident status',
    html.includes('Remediation status is tracked separately from the incident status above'));
  check('A stale verification asks for a re-check on the page', html.includes('Needs re-check'));
  check('Prevention section renders with levels', html.includes('Prevent It Again') && html.includes('>HIGH</span>'));
  check('No certainty about how access was obtained', !/site was infected through|admin password was (cracked|compromised)|confirmed administrator compromise/i.test(html));
  check('No malware/backdoor verdict language', !/backdoor planted|webshell detected|malware confirmed/i.test(html));

  /* ------------------------------------------------- SSRF, live behaviour */
  console.log('\nLive: outbound verification guard');

  const meta = await provision('Metadata Target Suite', 'http://169.254.169.254');
  await call('POST', '/api/blackbox/ingest', {
    site: meta.siteId,
    events: [{ eventId: `me_${uniq()}`, type: 'executable_created', category: 'file', timestamp: new Date().toISOString(), path: '/wp-content/uploads/cache/m.php', target: { path: '/wp-content/uploads/cache/m.php' } }],
  }, (body) => signed(meta.siteId, meta.key, body));
  const metaInc = (await call('GET', `/api/blackbox/incidents?site=${meta.siteId}`)).body?.incidents?.[0];
  const metaVerify = await call('POST', `/api/blackbox/incidents/${metaInc?.id}/verify`);
  const metaAvail = metaVerify.body?.verification?.results?.find((r) => r.kind === 'availability');
  check('A metadata-address site is never fetched', metaAvail?.state === 'not_monitored', JSON.stringify(metaAvail));
  check('The block is explained, not hidden', /link-local|always blocked/i.test(metaAvail?.detail ?? ''), metaAvail?.detail);

  const redir = await provision('Redirect Target Suite', redirectUrl);
  await call('POST', '/api/blackbox/ingest', {
    site: redir.siteId,
    events: [{ eventId: `rd_${uniq()}`, type: 'executable_created', category: 'file', timestamp: new Date().toISOString(), path: '/wp-content/uploads/cache/r.php', target: { path: '/wp-content/uploads/cache/r.php' } }],
  }, (body) => signed(redir.siteId, redir.key, body));
  const redirInc = (await call('GET', `/api/blackbox/incidents?site=${redir.siteId}`)).body?.incidents?.[0];
  const redirVerify = await call('POST', `/api/blackbox/incidents/${redirInc?.id}/verify`);
  const redirAvail = redirVerify.body?.verification?.results?.find((r) => r.kind === 'availability');
  check('A redirect into a blocked range is not followed', /redirect blocked/i.test(redirAvail?.detail ?? '') && redirAvail?.state === 'not_monitored', JSON.stringify(redirAvail));

  // A caller cannot substitute its own URL: the endpoint reads no body.
  const smuggled = await call('POST', `/api/blackbox/incidents/${incId}/verify`, { url: 'http://169.254.169.254/latest/meta-data/', target: 'http://127.0.0.1:1/' });
  const smuggledAvail = smuggled.body?.verification?.results?.find((r) => r.kind === 'availability');
  check('A user-supplied verification URL is ignored',
    smuggledAvail?.state !== 'not_monitored' || /Registered site origin|Not reachable/.test(smuggledAvail?.detail ?? ''),
    JSON.stringify(smuggledAvail));

  stub.close();
  redirectStub.close();

  /* ------------------------------------------ Unknown entry point, live */
  console.log('\nLive: unknown entry point');

  const U = await provision('Unknown Path Suite', 'https://unknown-path.example.com');
  const HU = (body) => signed(U.siteId, U.key, body);
  await call('POST', '/api/blackbox/ingest', {
    site: U.siteId,
    events: [
      { eventId: `uk_${uniq()}`, type: 'file_integrity_mismatch', category: 'file', timestamp: new Date().toISOString(), path: '/wp-content/themes/twentytwentyfour/style.css', target: { path: '/wp-content/themes/twentytwentyfour/style.css' } },
      { eventId: `up_${uniq()}`, type: 'permission_changed', category: 'file', timestamp: new Date().toISOString(), path: '/wp-content/uploads', target: { path: '/wp-content/uploads' } },
    ],
  }, HU);
  const uInc = (await call('GET', `/api/blackbox/incidents?site=${U.siteId}`)).body?.incidents?.[0];
  check('An incident without an identifiable path stays Unknown', uInc?.entryPoint?.id === 'unknown', uInc?.entryPoint?.id);
  check('Unknown is reported with a headline, not a guess', uInc?.entryPoint?.headline === 'Entry point not identified', uInc?.entryPoint?.headline);
  const uPage = norm((await call('GET', `/incidents/${uInc?.id}`)).html ?? '');
  check('The page says ScanSite will not guess an entry point', /will not guess an infection path/i.test(uPage));

  /* --------------------------------------------- plugin path, live */
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
  check('Its label is the hedged one', bInc?.entryPoint?.label === 'Possible plugin-related entry point', bInc?.entryPoint?.label);
  check('Its plan targets the plugin, not an account',
    (bInc?.remediation?.priorities ?? []).some((p) => p.id === 'integrity' && /woocommerce/.test(JSON.stringify(p.items))),
    JSON.stringify(bInc?.remediation?.priorities?.map((p) => p.id)));
  check('Its plan does not invent an administrator to secure',
    !(bInc?.remediation?.priorities ?? []).some((p) => p.id === 'secure-access'), JSON.stringify(bInc?.remediation?.priorities?.map((p) => p.id)));
}

/* ------------------------------------------------------------- cleanup */
for (const id of createdSites) await call('DELETE', `/api/blackbox/sites/${id}?purge=true`);

console.log(`\n${fail === 0 ? '✓' : '✗'} remediation suite: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
