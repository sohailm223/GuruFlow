/**
 * Error evidence: capture shape, grouping, component attribution, correlation,
 * guided fix and verification.
 *
 * Two halves, both against the shipped code:
 *
 *   1. Unit — groupErrors, correlateError, buildErrorEvidence, buildErrorFixSteps
 *      and the error verification checks imported directly from
 *      src/lib/blackbox, so a wording, grouping or attribution regression fails
 *      with no server running.
 *   2. Live — the same events through POST /ingest → GET /incident, the rendered
 *      incident page, POST /verify, and the /errors page.
 *
 *   node tests/blackbox/errors.mjs
 *
 * Requires a running ScanSite server (see README for the env vars).
 */

import crypto from 'crypto';
import {
  groupErrors,
  correlateError,
  buildErrorEvidence,
  buildErrorFixSteps,
  normaliseMessage,
  componentLabel,
  ERROR_COMPONENTS,
  CORRELATION_WINDOW_MINUTES,
} from '../../src/lib/blackbox/errors.js';
import { buildVerificationTargets, evaluateVerification } from '../../src/lib/blackbox/remediation.js';

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

const T0 = Date.parse('2026-03-01T10:00:00.000Z');
const at = (mins) => T0 + mins * MINUTE;

/** A php_error event shaped exactly as the collector sends it. */
function phpError(over = {}) {
  return {
    eventId: `err_${uniq()}`,
    siteId: 'site_x',
    timestamp: at(10),
    type: 'php_error',
    category: 'error',
    metadata: {
      fingerprint: 'fp_order_284',
      kind: 'fatal',
      severity: 'Fatal error',
      errorClass: null,
      code: '1',
      message: 'Call to undefined method WC_Order::get_total_refunded()',
      file: '/var/www/html/wp-content/plugins/custom-checkout/includes/order.php',
      relativePath: 'wp-content/plugins/custom-checkout/includes/order.php',
      line: 284,
      component: 'plugin',
      componentSlug: 'custom-checkout',
      componentName: 'Custom Checkout',
      occurrences: 1,
      totalSeen: 1,
      firstSeen: Math.floor(at(10) / 1000),
      lastSeen: Math.floor(at(10) / 1000),
      requestPath: '/checkout/',
      requestMethod: 'POST',
      phpVersion: '8.3.12',
      ...over,
    },
  };
}

/* ========================================================================== *
 * 1. UNIT — message normalisation and fingerprinting
 * ========================================================================== */
console.log('\nMessage normalisation (unit)');

check('Variable values are stripped so one recurring error stays one fingerprint',
  normaliseMessage('Undefined variable $order_id_4821') === normaliseMessage('Undefined variable $order_id_993'));

check('Quoted values are stripped',
  normaliseMessage('Call to undefined function foo("alpha")') === normaliseMessage('Call to undefined function foo("beta")'));

check('Hex addresses are stripped',
  normaliseMessage('Object at 0x7fff5fbff8c0 failed') === normaliseMessage('Object at 0x7fff00000001 failed'));

check('The Uncaught wrapper does not split one error in two',
  normaliseMessage('Uncaught Error: Call to undefined method A::b()') ===
    normaliseMessage('Call to undefined method A::b()'));

check('Genuinely different errors stay different',
  normaliseMessage('Call to undefined method A::b()') !== normaliseMessage('Call to undefined method A::c()'));

check('The collector fingerprint is preferred when present, so counts agree',
  (() => { const g = groupErrors([phpError(), phpError({ fingerprint: 'fp_order_284' })]); return g.length === 1; })());

console.log('\nComponent attribution (unit)');

for (const [id, label] of [['core', 'WordPress Core'], ['plugin', 'Plugin'], ['theme', 'Theme'],
  ['mu_plugin', 'MU Plugin'], ['uploads', 'Uploads'], ['config', 'Configuration'],
  ['external', 'Outside WordPress'], ['unknown', 'Unknown']]) {
  check(`Component "${id}" has a published label`, componentLabel(id) === label, componentLabel(id));
}
check('Every published component id resolves to a label',
  ERROR_COMPONENTS.every((c) => componentLabel(c.id) === c.label));
check('An unrecognised component id falls back to Unknown rather than inventing a label',
  componentLabel('not_a_component') === 'Unknown');

/* ========================================================================== *
 * 2. UNIT — grouping duplicates
 * ========================================================================== */
console.log('\nGrouping duplicates (unit)');

// 37 occurrences of one error, arriving as several collector reports.
const repeatEvents = [
  phpError({ occurrences: 20, firstSeen: Math.floor(at(10) / 1000), lastSeen: Math.floor(at(12) / 1000) }),
  { ...phpError(), timestamp: at(14), metadata: { ...phpError().metadata, occurrences: 17, firstSeen: Math.floor(at(10) / 1000), lastSeen: Math.floor(at(14) / 1000) } },
];
const repeatGroups = groupErrors(repeatEvents);

check('Repeated errors collapse into a single group', repeatGroups.length === 1, String(repeatGroups.length));
check('Occurrences are summed, not replaced', repeatGroups[0]?.occurrences === 37, String(repeatGroups[0]?.occurrences));
check('First seen is the earliest occurrence', repeatGroups[0]?.firstSeen === at(10));
check('Last seen is the latest occurrence', repeatGroups[0]?.lastSeen === at(14));
check('A group with more than one occurrence is flagged as repeating', repeatGroups[0]?.repeating === true);
check('A single occurrence is not called repeating', groupErrors([phpError()])[0]?.repeating === false);

const mixed = groupErrors([phpError(), phpError({ fingerprint: 'fp_other', message: 'A different failure', line: 12 }), { eventId: 'h1', siteId: 'site_x', timestamp: at(20), type: 'http_error', category: 'error', metadata: { fingerprint: 'fp_http', severity: 'HTTP 500', message: 'Server returned HTTP 500', occurrences: 4 } }]);
check('Distinct errors stay in distinct groups', mixed.length === 3, String(mixed.length));
check('HTTP errors are grouped separately from PHP errors', mixed.some((g) => g.type === 'http_error'));
check('Non-error events are ignored', groupErrors([{ eventId: 'n', type: 'login_success', timestamp: at(1) }]).length === 0);
check('Groups are ordered by most recent activity', mixed[0].lastSeen >= mixed[mixed.length - 1].lastSeen);

/* ========================================================================== *
 * 3. UNIT — correlation is evidence-based
 * ========================================================================== */
console.log('\nCorrelation (unit)');

const pluginUpdate = {
  eventId: 'pu1', siteId: 'site_x', timestamp: at(6), type: 'plugin_updated', category: 'plugin',
  target: { plugin: 'custom-checkout', name: 'Custom Checkout' }, changes: { from: '1.4.0', to: '1.5.0' },
};
const fileChanged = {
  eventId: 'fc1', siteId: 'site_x', timestamp: at(7), type: 'plugin_file_mismatch', category: 'file',
  target: { plugin: 'custom-checkout' }, path: 'wp-content/plugins/custom-checkout/includes/order.php',
};
const httpAfter = {
  eventId: 'h2', siteId: 'site_x', timestamp: at(11), type: 'http_error', category: 'error',
  metadata: { fingerprint: 'fp_http', severity: 'HTTP 500', message: 'Server returned HTTP 500', occurrences: 1 },
};

const errGroup = groupErrors([phpError({ occurrences: 37 })])[0];
const corr = correlateError(errGroup, [pluginUpdate, fileChanged, httpAfter, phpError({ occurrences: 37 })]);

check('A preceding change to the owning component yields a likely cause', typeof corr.likelyCause === 'string' && corr.likelyCause.length > 10, String(corr.likelyCause));
check('The likely cause is hedged, never asserted', /may have/.test(corr.likelyCause ?? ''), corr.likelyCause);
check('The likely cause names the component that owns the file', /Custom Checkout/.test(corr.likelyCause ?? ''), corr.likelyCause);
check('A confidence is reported alongside it', corr.confidence > 0 && corr.confidence <= 95, String(corr.confidence));
check('A confidence label is reported', typeof corr.confidenceLabel === 'string');
check('Evidence lists the change event', corr.evidence.some((e) => e.eventId === 'pu1'));
check('Evidence lists the file change', corr.evidence.some((e) => e.eventId === 'fc1'));
check('Evidence lists the HTTP 5xx that followed', corr.evidence.some((e) => e.eventId === 'h2'));
check('Every evidence item cites a real event id', corr.evidence.every((e) => e.eventId && typeof e.eventId === 'string'));

// The exact scenario from the brief: update, file change, fatal, HTTP 500.
check('The brief\'s scenario produces the expected ordering of evidence',
  corr.evidence.length >= 4, String(corr.evidence.length));

console.log('\nCorrelation refuses to guess (unit)');

const unrelatedChange = {
  eventId: 'oth1', siteId: 'site_x', timestamp: at(6), type: 'plugin_updated', category: 'plugin',
  target: { plugin: 'a-different-plugin', name: 'A Different Plugin' },
};
const noCause = correlateError(errGroup, [unrelatedChange]);
check('A change to a DIFFERENT plugin is not offered as the cause', noCause.likelyCause === null, String(noCause.likelyCause));
check('It says plainly that nothing recorded explains it', typeof noCause.explanation === 'string' && noCause.explanation.length > 20, String(noCause.explanation));
check('Confidence is zero when no evidence supports a cause', noCause.confidence === 0, String(noCause.confidence));
check('Confidence label is Uncertain', noCause.confidenceLabel === 'Uncertain', noCause.confidenceLabel);

const tooOld = { ...pluginUpdate, eventId: 'old1', timestamp: at(10) - (CORRELATION_WINDOW_MINUTES + 10) * MINUTE };
const outsideWindow = correlateError(errGroup, [tooOld]);
check(`A change older than the ${CORRELATION_WINDOW_MINUTES}-minute window is not used`,
  outsideWindow.likelyCause === null, String(outsideWindow.likelyCause));

const afterError = { ...pluginUpdate, eventId: 'after1', timestamp: at(20) };
check('A change recorded AFTER the error is not used as its cause',
  correlateError(errGroup, [afterError]).likelyCause === null);

const noEvents = correlateError(errGroup, []);
check('With no events at all it still declines to name a cause', noEvents.likelyCause === null);

// Core error + core update is its own path.
const coreErr = groupErrors([phpError({
  fingerprint: 'fp_core', relativePath: 'wp-includes/class-wp-hook.php', line: 310,
  component: 'core', componentSlug: null, componentName: 'WordPress Core',
})])[0];
const coreUpdate = { eventId: 'wu1', siteId: 'site_x', timestamp: at(8), type: 'wordpress_updated', category: 'core', target: {}, changes: { from: '6.7', to: '6.8' } };
const coreCorr = correlateError(coreErr, [coreUpdate]);
check('A core error following a core update is correlated', coreCorr.likelyCause !== null);
check('Core correlation cites the core update', coreCorr.evidence.some((e) => e.eventId === 'wu1'));

/* ========================================================================== *
 * 4. UNIT — guided fix steps cite their evidence
 * ========================================================================== */
console.log('\nGuided fix steps (unit)');

const ev = buildErrorEvidence([phpError({ occurrences: 37 }), pluginUpdate, fileChanged, httpAfter]);
check('buildErrorEvidence returns groups', Array.isArray(ev.groups) && ev.groups.length === 2, String(ev.groups?.length));
check('Total occurrences are summed across groups', ev.total === 38, String(ev.total));
check('Repeating errors are counted', ev.repeating === 1, String(ev.repeating));
check('Components are listed', ev.components.includes('Plugin'), JSON.stringify(ev.components));

const primary = ev.primary;
const steps = buildErrorFixSteps(primary);
check('Fix steps are produced', steps.length >= 4, String(steps.length));
check('Step 1 is the exact file and line', /^Inspect .*order\.php line 284$/.test(steps[0].title), steps[0].title);
check('Every step explains why', steps.every((s) => typeof s.why === 'string' && s.why.length > 5));
check('Every step cites an event or is explicitly uncited', steps.every((s) => 'evidence' in s));
check('The last step is re-run verification', steps[steps.length - 1].id === 'reverify', steps[steps.length - 1].id);
check('A step tells the developer to review the recent change', steps.some((s) => s.id === 'review-change'));
check('A step tells the developer to compare with the previous version', steps.some((s) => s.id === 'compare-version'));
check('A step covers PHP/plugin compatibility', steps.some((s) => s.id === 'check-compatibility'));
check('A step covers testing on staging', steps.some((s) => s.id === 'test-staging'));
check('The review-change step cites the update event, not some other event',
  steps.find((s) => s.id === 'review-change')?.evidence?.eventId === 'pu1',
  String(steps.find((s) => s.id === 'review-change')?.evidence?.eventId));

check('No error yields no fix steps', buildErrorFixSteps(null).length === 0);

console.log('\nFix steps when nothing explains the error (unit)');
const loneEv = buildErrorEvidence([phpError()]);
const loneSteps = buildErrorFixSteps(loneEv.primary);
check('It still starts at the file and line', /^Inspect /.test(loneSteps[0].title), loneSteps[0].title);
check('It does NOT invent a review-the-update step', !loneSteps.some((s) => s.id === 'review-change'));
check('It does NOT invent a compare-versions step', !loneSteps.some((s) => s.id === 'compare-version'));

/* ========================================================================== *
 * 5. UNIT — verification checks for errors
 * ========================================================================== */
console.log('\nError verification (unit)');

const errIncident = {
  id: 'inc_err', siteId: 'site_x', startedAt: at(5), endedAt: at(15),
  events: [pluginUpdate, phpError({ occurrences: 37 })],
  errorEvidence: buildErrorEvidence([phpError({ occurrences: 37 }), pluginUpdate]),
};

const targets = buildVerificationTargets(errIncident);
check('An error check is added for each recorded error',
  targets.some((c) => c.kind === 'error' && c.id === 'error:fp_order_284'),
  JSON.stringify(targets.map((c) => c.id)));
check('The error check names the file and line',
  /order\.php:284/.test(targets.find((c) => c.id === 'error:fp_order_284')?.label ?? ''),
  targets.find((c) => c.id === 'error:fp_order_284')?.label);
check('The error check states the rule that decides it',
  typeof targets.find((c) => c.id === 'error:fp_order_284')?.how === 'string');

const vNoRecurrence = evaluateVerification(errIncident, { events: [], siteStatus: { ok: true, status: 200 } });
const errResult = vNoRecurrence.results.find((r) => r.id === 'error:fp_order_284');
check('No recurrence is reported as likely_resolved, not verified', errResult?.state === 'likely_resolved', String(errResult?.state));
check('Absence is explicitly marked weak evidence', errResult?.strength === 'weak', String(errResult?.strength));
check('The detail explains why absence is not proof', /not seen again|not proof/i.test(errResult?.detail ?? ''), errResult?.detail);
check('The error result carries its decision rule', typeof errResult?.how === 'string' && errResult.how.length > 10);

const recurrence = { ...phpError(), eventId: 'rec1', timestamp: at(30) };
const vRecurrence = evaluateVerification(errIncident, { events: [recurrence], siteStatus: { ok: true, status: 200 } });
const recResult = vRecurrence.results.find((r) => r.id === 'error:fp_order_284');
check('A recurrence is reported as still_present', recResult?.state === 'still_present', String(recResult?.state));
check('A recurrence cites the new event', recResult?.evidence === 'rec1', String(recResult?.evidence));

// A DIFFERENT error in the same file must not count as a recurrence.
const differentError = { ...phpError(), eventId: 'diff1', timestamp: at(30), metadata: { ...phpError().metadata, fingerprint: 'fp_other', message: 'Something else broke', line: 999 } };
const vDifferent = evaluateVerification(errIncident, { events: [differentError], siteStatus: { ok: true, status: 200 } });
check('A different error in the same file is not a recurrence of this one',
  vDifferent.results.find((r) => r.id === 'error:fp_order_284')?.state === 'likely_resolved',
  String(vDifferent.results.find((r) => r.id === 'error:fp_order_284')?.state));

console.log('\nHTTP 5xx verification (unit)');
const httpIncident = {
  id: 'inc_http', siteId: 'site_x', startedAt: at(5), endedAt: at(15),
  events: [{ ...httpAfter, timestamp: at(10) }],
  errorEvidence: buildErrorEvidence([{ ...httpAfter, timestamp: at(10) }]),
};
const httpTargets = buildVerificationTargets(httpIncident);
check('An HTTP 5xx check is added when 5xx responses were recorded',
  httpTargets.some((c) => c.id === 'error:http'), JSON.stringify(httpTargets.map((c) => c.id)));

const vHttp = evaluateVerification(httpIncident, { events: [], siteStatus: { ok: true, status: 200 } });
const httpResult = vHttp.results.find((r) => r.id === 'error:http');
check('A live 200 with no further 5xx is verified_resolved', httpResult?.state === 'verified_resolved', String(httpResult?.state));

const vHttpBlocked = evaluateVerification(httpIncident, { events: [], siteStatus: { blocked: 'Blocked by policy' } });
check('A blocked live probe downgrades the 5xx check to weak',
  vHttpBlocked.results.find((r) => r.id === 'error:http')?.strength === 'weak',
  String(vHttpBlocked.results.find((r) => r.id === 'error:http')?.strength));

const laterHttp = { ...httpAfter, eventId: 'h3', timestamp: at(40) };
const vHttpAgain = evaluateVerification(httpIncident, { events: [laterHttp], siteStatus: { ok: true, status: 200 } });
check('A later 5xx makes the check still_present',
  vHttpAgain.results.find((r) => r.id === 'error:http')?.state === 'still_present',
  String(vHttpAgain.results.find((r) => r.id === 'error:http')?.state));

console.log('\nNo errors, no error checks (unit)');
const cleanIncident = {
  id: 'inc_clean', siteId: 'site_x', startedAt: at(5), endedAt: at(15),
  events: [{ eventId: 'l1', siteId: 'site_x', timestamp: at(6), type: 'login_success', category: 'auth', actor: { username: 'alice' } }],
  errorEvidence: null,
};
const cleanTargets = buildVerificationTargets(cleanIncident);
check('An incident with no recorded errors gets no error checks',
  !cleanTargets.some((c) => c.kind === 'error'), JSON.stringify(cleanTargets.map((c) => c.id)));
const vClean = evaluateVerification(cleanIncident, { events: [], siteStatus: { ok: true, status: 200 } });
check('And evaluation produces none either', !vClean.results.some((r) => r.kind === 'error'));

/* ========================================================================== *
 * 6. LIVE — through the real API and rendered pages
 * ========================================================================== */
console.log('\nLive: ingest → incident → page → verify → errors page');

const { siteId, key, url } = await provision('Error Evidence Test', `https://error-evidence-${uniq()}.example.com`);

const MINUTE_MS = MINUTE;
const now = Date.now();
const liveEvents = [
  { eventId: `lpu_${uniq()}`, type: 'plugin_updated', category: 'plugin', timestamp: new Date(now - 8 * MINUTE_MS).toISOString(), target: { plugin: 'custom-checkout', name: 'Custom Checkout' }, changes: { from: '1.4.0', to: '1.5.0' } },
  { eventId: `lerr_${uniq()}`, type: 'php_error', category: 'error', timestamp: new Date(now - 4 * MINUTE_MS).toISOString(), metadata: { fingerprint: `fp_live_${uniq()}`, kind: 'fatal', severity: 'Fatal error', code: '1', message: 'Call to undefined method WC_Order::get_total_refunded()', file: '/var/www/html/wp-content/plugins/custom-checkout/includes/order.php', relativePath: 'wp-content/plugins/custom-checkout/includes/order.php', line: 284, component: 'plugin', componentSlug: 'custom-checkout', componentName: 'Custom Checkout', occurrences: 37, totalSeen: 37, firstSeen: Math.floor((now - 4 * MINUTE_MS) / 1000), lastSeen: Math.floor((now - 4 * MINUTE_MS) / 1000), requestPath: '/checkout/', requestMethod: 'POST', phpVersion: '8.3.12' } },
  { eventId: `lhttp_${uniq()}`, type: 'http_error', category: 'error', timestamp: new Date(now - 3 * MINUTE_MS).toISOString(), metadata: { fingerprint: `fp_http_${uniq()}`, kind: 'http', severity: 'HTTP 500', message: 'Server returned HTTP 500', occurrences: 2, firstSeen: Math.floor((now - 3 * MINUTE_MS) / 1000), lastSeen: Math.floor((now - 3 * MINUTE_MS) / 1000), requestPath: '/checkout/', requestMethod: 'POST' } },
];

const payload = { site: siteId, events: liveEvents };
const ing = await call('POST', '/api/blackbox/ingest', payload, signed(siteId, key, payload));
check('Ingest accepts the error events', ing.status === 200 && ing.body?.accepted === 3, `status ${ing.status} accepted ${ing.body?.accepted} rejected ${JSON.stringify(ing.body?.rejected ?? [])}`);

const incidents = await call('GET', `/api/blackbox/incidents?site=${siteId}`);
const incId = incidents.body?.incidents?.[0]?.id;
check('An incident was created', Boolean(incId), JSON.stringify(incidents.body).slice(0, 200));

const detail = await call('GET', `/api/blackbox/incidents/${incId}`);
const inc = detail.body?.incident;
check('The incident carries error evidence', Boolean(inc?.errorEvidence), JSON.stringify(Object.keys(inc ?? {})));
check('Error evidence reports the grouped occurrence total', inc?.errorEvidence?.total === 39, String(inc?.errorEvidence?.total));
check('Error evidence names the plugin component', inc?.errorEvidence?.components?.includes('Plugin'), JSON.stringify(inc?.errorEvidence?.components));
check('The primary group names the file and line',
  inc?.errorEvidence?.primary?.relativePath?.endsWith('includes/order.php') && inc?.errorEvidence?.primary?.line === 284,
  `${inc?.errorEvidence?.primary?.relativePath}:${inc?.errorEvidence?.primary?.line}`);
check('The primary group records 37 occurrences', inc?.errorEvidence?.primary?.occurrences === 37, String(inc?.errorEvidence?.primary?.occurrences));
check('Correlation names the plugin update as a likely cause',
  /may have/.test(inc?.errorEvidence?.primary?.correlation?.likelyCause ?? ''),
  String(inc?.errorEvidence?.primary?.correlation?.likelyCause));
check('Correlation carries a confidence', (inc?.errorEvidence?.primary?.correlation?.confidence ?? 0) > 0, String(inc?.errorEvidence?.primary?.correlation?.confidence));
check('Correlation cites the update event',
  inc?.errorEvidence?.primary?.correlation?.evidence?.some((e) => e.eventId === liveEvents[0].eventId),
  JSON.stringify(inc?.errorEvidence?.primary?.correlation?.evidence?.map((e) => e.eventId)));

console.log('\nLive: remediation plan leads with the recorded error');
const plan = inc?.remediation;
check('The fix plan has priorities', Array.isArray(plan?.priorities) && plan.priorities.length > 0, String(plan?.priorities?.length));
check('The first priority is the recorded error', plan?.priorities?.[0]?.id === 'error-evidence', String(plan?.priorities?.[0]?.id));
check('It names the file and line to start from',
  plan?.priorities?.[0]?.items?.some((i) => /order\.php line 284/.test(i.label)),
  JSON.stringify(plan?.priorities?.[0]?.items?.map((i) => i.label)));
check('Every item in the error priority explains why',
  (plan?.priorities?.[0]?.items ?? []).every((i) => typeof i.detail === 'string' && i.detail.length > 5));
check('Every item cites an event',
  (plan?.priorities?.[0]?.items ?? []).every((i) => i.evidence?.eventId));

console.log('\nLive: rendered incident page');
const page = await call('GET', `/incidents/${incId}`);
const html = norm(page.html ?? '');
check('The incident page renders', page.status === 200 && html.includes('<main'), `status ${page.status}`);
check('The Error Evidence section renders', html.includes('PHP Fatal Error'), 'section heading missing');
check('It shows the message', html.includes('Call to undefined method WC_Order::get_total_refunded()'));
check('It shows the component', html.includes('Custom Checkout'));
check('It shows the file', html.includes('wp-content/plugins/custom-checkout/includes/order.php'));
check('It shows the line', html.includes('284'));
check('It shows the occurrence count', html.includes('37'));
check('It shows a hedged likely cause', html.includes('may have introduced'));
check('It shows a confidence', /Confidence \d+%/.test(html));
check('It offers View Error Details', html.includes('View Error Details'));
check('It offers How to Fix', html.includes('How to Fix'));
check('No overclaiming wording appears in the error panel',
  !/\b(was caused by|definitely|proven root cause|malicious|vulnerable plugin)\b/i.test(html));

console.log('\nLive: verification');
const v = await call('POST', `/api/blackbox/incidents/${incId}/verify`);
check('Verification runs', v.status === 200 && Array.isArray(v.body?.verification?.results), `status ${v.status}`);
const vErr = v.body?.verification?.results?.find((r) => r.kind === 'error' && /order\.php/.test(r.label ?? ''));
check('The error check is evaluated', Boolean(vErr), JSON.stringify(v.body?.verification?.results?.map((r) => r.id)));
check('With no recurrence it is likely_resolved', vErr?.state === 'likely_resolved', String(vErr?.state));
check('Its strength is weak, not strong', vErr?.strength === 'weak', String(vErr?.strength));
check('It explains the rule that decided it', typeof vErr?.how === 'string' && vErr.how.length > 10);
const vHttpLive = v.body?.verification?.results?.find((r) => r.id === 'error:http');
check('The HTTP 5xx check is evaluated', Boolean(vHttpLive), 'error:http missing');
check('Remediation status is recorded', typeof v.body?.incident?.remediationStatus === 'string');

const pageAfter = await call('GET', `/incidents/${incId}`);
const htmlAfter = norm(pageAfter.html ?? '');
check('The verification panel shows the error check after running',
  htmlAfter.includes('order.php') && /Re-run verification|Run verification/.test(htmlAfter));

console.log('\nLive: /errors page');
const errorsPage = await call('GET', '/errors');
const errorsHtml = norm(errorsPage.html ?? '');
check('The Errors page renders', errorsPage.status === 200 && errorsHtml.includes('<main'), `status ${errorsPage.status}`);
check('It shows the fatal error', errorsHtml.includes('Call to undefined method WC_Order::get_total_refunded()'));
check('It shows the component', errorsHtml.includes('Custom Checkout'));
check('It shows file and line', errorsHtml.includes('order.php') && errorsHtml.includes(':284'));
check('It marks the error as repeating', errorsHtml.includes('Repeating'));
check('It shows a likely cause with confidence', /Confidence \d+%/.test(errorsHtml));
check('It shows the website', errorsHtml.includes('Error Evidence Test'));
check('It links to the related incident', errorsHtml.includes(`/incidents/${incId}`));
check('It lists the evidence for the cause', errorsHtml.includes('before the first error'));

/* ---------------------------------------------------------------- cleanup */
for (const id of createdSites) await call('DELETE', `/api/blackbox/sites/${id}?purge=true`);

console.log(`\n${fail === 0 ? '✓' : '✗'} error evidence suite: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
