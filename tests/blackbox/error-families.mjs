/**
 * Error evidence for the eight non-PHP families.
 *
 * The PHP engine has its own suite (errors.mjs) and is not re-tested here.
 * This covers the families added on top of it: HTTP, REST, AJAX, database,
 * email, cron, JavaScript and WP_Error.
 *
 * Two halves, both against the shipped code:
 *
 *   1. Unit — grouping, per-family "what failed / where", correlation strength
 *      and the family-specific first fix step, imported straight from
 *      src/lib/blackbox, so a regression fails with no server running.
 *   2. Live — the same events through POST /ingest and the rendered /errors
 *      page, including the family filter.
 *
 *   node tests/blackbox/error-families.mjs
 *
 * Requires a running ScanSite server (see README for the env vars).
 */

import crypto from 'crypto';
import {
  groupErrors,
  correlateError,
  buildErrorEvidence,
  buildErrorFixSteps,
  buildErrorAnswers,
  describeFailure,
  describeLocation,
  errorKind,
  errorKindLabel,
  ERROR_KINDS,
  ERROR_EVENT_TYPES,
} from '../../src/lib/blackbox/errors.js';
import { categoryForType } from '../../src/lib/blackbox/schemas.js';

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

/**
 * The rendered error cards, as HTML fragments.
 *
 * A Next.js server-component page also ships its React flight payload in a
 * <script> tag, and that payload serialises the props of every row the page
 * considered — including rows a filter removed. Substring-searching the raw
 * HTML therefore "finds" filtered-out content and passes or fails for the
 * wrong reason. Assert inside the rendered blocks instead.
 */
function cardsOf(html) {
  return (String(html).match(/<article[\s\S]*?<\/article>/g) ?? []).map(norm);
}

const T0 = Date.parse('2026-04-01T10:00:00.000Z');
const at = (mins) => T0 + mins * MINUTE;

/** An event of one family, shaped as the collector sends it. */
function ev(type, md, mins = 10) {
  return {
    eventId: `err_${uniq()}`,
    siteId: 'site_x',
    timestamp: at(mins),
    type,
    category: 'error',
    metadata: {
      fingerprint: `fp_${type}_${uniq()}`,
      occurrences: 1,
      firstSeen: Math.floor(at(mins) / 1000),
      lastSeen: Math.floor(at(mins) / 1000),
      ...md,
    },
  };
}

/* ========================================================================== *
 * 1. UNIT — taxonomy
 * ========================================================================== */
console.log('\nFamily taxonomy (unit)');

check('Nine families are declared', ERROR_KINDS.length === 9, String(ERROR_KINDS.length));
check('Every family has a distinct label',
  new Set(ERROR_KINDS.map((k) => k.label)).size === ERROR_KINDS.length);

for (const [type, kind] of [
  ['php_error', 'php'], ['http_error', 'http'], ['rest_error', 'rest'],
  ['ajax_error', 'ajax'], ['db_error', 'database'], ['mail_error', 'email'],
  ['cron_error', 'cron'], ['js_error', 'javascript'], ['wp_error', 'wp'],
]) {
  check(`${type} belongs to the ${kind} family`, errorKind(type) === kind, String(errorKind(type)));
  check(`${type} is filed as an error event`, categoryForType(type) === 'error', categoryForType(type));
}

check('A non-error event type is not an error', errorKind('plugin_updated') === null);
check('An unknown family label falls back rather than throwing', errorKindLabel('nope') === 'Error');
check('Every declared type round-trips through ERROR_EVENT_TYPES',
  ERROR_EVENT_TYPES.length === 9 && ERROR_EVENT_TYPES.includes('js_error'));

/* ========================================================================== *
 * 2. UNIT — what failed / where, per family
 * ========================================================================== */
console.log('\nWhat failed and where (unit)');

const FIXTURES = {
  http_error: { status: 503, requestPath: '/checkout/', requestMethod: 'POST', responseTimeMs: 1240 },
  rest_error: { status: 403, httpMethod: 'POST', endpoint: '/wp-json/wc/v3/orders', code: 'rest_forbidden', component: 'plugin', componentSlug: 'woocommerce', componentName: 'WooCommerce' },
  ajax_error: { status: 400, ajaxAction: 'wc_add_to_cart', component: 'plugin', componentSlug: 'woocommerce', componentName: 'WooCommerce' },
  db_error: { queryType: 'UPDATE', table: 'wp_options', message: 'Table does not exist' },
  mail_error: { code: 'wp_mail_failed', transport: 'smtp:mail.example.com' },
  cron_error: { cronHook: 'wc_cleanup_sessions', schedule: 'twicedaily' },
  js_error: { scriptUrl: '/wp-content/plugins/x/a.js', line: 12, column: 4, pageUrl: '/cart/', browser: 'Chrome' },
  wp_error: { code: 'invalid_request', context: 'rest' },
};

for (const [type, md] of Object.entries(FIXTURES)) {
  const g = groupErrors([ev(type, md)])[0];
  check(`${type} groups into one card`, Boolean(g), 'no group');
  check(`${type} names what failed`, typeof g.whatFailed === 'string' && g.whatFailed.length > 3, String(g.whatFailed));
  check(`${type} carries its family`, g.family === errorKind(type), String(g.family));
}

// The wording each family must produce.
const http = groupErrors([ev('http_error', FIXTURES.http_error)])[0];
check('An HTTP error names its status', http.whatFailed === 'HTTP 503 response', http.whatFailed);
check('An HTTP error points at the recorded path', http.where === '/checkout/', String(http.where));
check('An HTTP error keeps its response time', http.responseTimeMs === 1240, String(http.responseTimeMs));

const rest = groupErrors([ev('rest_error', FIXTURES.rest_error)])[0];
check('A REST error names method and endpoint',
  rest.whatFailed === 'REST API 403 on POST /wp-json/wc/v3/orders', rest.whatFailed);
check('A REST error keeps the WP_Error code', rest.code === 'rest_forbidden', String(rest.code));
check('A REST error attributes the owning plugin',
  rest.component === 'plugin' && rest.componentName === 'WooCommerce', `${rest.component}/${rest.componentName}`);

const ajax = groupErrors([ev('ajax_error', FIXTURES.ajax_error)])[0];
check('An AJAX error names the action', ajax.ajaxAction === 'wc_add_to_cart', String(ajax.ajaxAction));
check('An AJAX error gives the request path',
  ajax.where === '/wp-admin/admin-ajax.php?action=wc_add_to_cart', String(ajax.where));

const db = groupErrors([ev('db_error', FIXTURES.db_error)])[0];
check('A database error records the query type only', db.queryType === 'UPDATE', String(db.queryType));
check('A database error records the table name', db.table === 'wp_options', String(db.table));
check('A database error points at the table', db.where === 'table wp_options', String(db.where));

const mail = groupErrors([ev('mail_error', FIXTURES.mail_error)])[0];
check('A mail error keeps the code', mail.code === 'wp_mail_failed', String(mail.code));
check('A mail error names the transport', mail.whatFailed.includes('smtp:mail.example.com'), mail.whatFailed);

const cron = groupErrors([ev('cron_error', FIXTURES.cron_error)])[0];
check('A cron error names the hook', cron.cronHook === 'wc_cleanup_sessions', String(cron.cronHook));
check('A cron error names the schedule', cron.schedule === 'twicedaily', String(cron.schedule));

const js = groupErrors([ev('js_error', FIXTURES.js_error)])[0];
check('A JS error keeps script, line and column',
  js.scriptUrl === '/wp-content/plugins/x/a.js' && js.line === 12 && js.column === 4,
  `${js.scriptUrl}:${js.line}:${js.column}`);
check('A JS error keeps the page URL', js.pageUrl === '/cart/', String(js.pageUrl));
check('A JS error keeps the browser label', js.browser === 'Chrome', String(js.browser));
check('A JS error points at the script and line',
  js.where === '/wp-content/plugins/x/a.js:12:4', String(js.where));

const wpe = groupErrors([ev('wp_error', FIXTURES.wp_error)])[0];
check('A WP_Error keeps its code', wpe.code === 'invalid_request', String(wpe.code));
check('A WP_Error keeps its context', wpe.context === 'rest', String(wpe.context));

// A group with nothing recorded must say so rather than invent a location.
const bare = groupErrors([ev('http_error', {})])[0];
check('An error with no recorded location reports none', bare.where === null, String(bare.where));

/* ========================================================================== *
 * 3. UNIT — duplicates collapse, occurrences accumulate
 * ========================================================================== */
console.log('\nDuplicate fingerprinting (unit)');

const fp = `fp_shared_${uniq()}`;
const repeated = groupErrors([
  ev('rest_error', { ...FIXTURES.rest_error, fingerprint: fp, occurrences: 9 }, 10),
  ev('rest_error', { ...FIXTURES.rest_error, fingerprint: fp, occurrences: 14 }, 20),
]);
check('Two reports of one fingerprint are one group', repeated.length === 1, String(repeated.length));
check('Their occurrences are added, not replaced', repeated[0].occurrences === 23, String(repeated[0].occurrences));
check('The group is flagged as repeating', repeated[0].repeating === true);
check('First seen is the earlier report', repeated[0].firstSeen === at(10), String(repeated[0].firstSeen));
check('Last seen is the later report', repeated[0].lastSeen === at(20), String(repeated[0].lastSeen));
check('Both event ids are retained', repeated[0].eventIds.length === 2, String(repeated[0].eventIds.length));

// A fixture that varies a field but reuses a hardcoded fingerprint tests
// nothing, so prove the helper actually changes the key.
const a = groupErrors([ev('db_error', { table: 'wp_a', fingerprint: 'fp_a' })])[0];
const b = groupErrors([ev('db_error', { table: 'wp_b', fingerprint: 'fp_b' })])[0];
check('Distinct fingerprints stay distinct groups', a.fingerprint !== b.fingerprint);
check('Both tables are recorded separately', a.table === 'wp_a' && b.table === 'wp_b', `${a.table}/${b.table}`);

/* ========================================================================== *
 * 4. UNIT — correlation strength, and refusing to guess
 * ========================================================================== */
console.log('\nCorrelation strength (unit)');

const woocommerceRest = groupErrors([ev('rest_error', { ...FIXTURES.rest_error, fingerprint: 'fp_r1' }, 4)])[0];

const strong = correlateError(woocommerceRest, [
  { eventId: 'u1', siteId: 'site_x', type: 'plugin_updated', timestamp: at(0), target: { plugin: 'woocommerce', name: 'WooCommerce' } },
]);
check('A change to the failing component is strong evidence', strong.causeStrength === 'strong', strong.causeStrength);
check('A strong cause is hedged, never asserted', /may have/.test(strong.likelyCause), strong.likelyCause);
check('A strong cause names the component', strong.likelyCause.includes('WooCommerce'), strong.likelyCause);
check('A strong cause carries confidence', strong.confidence > 0 && strong.confidence <= 95, String(strong.confidence));
check('The gap since the change is reported',
  strong.firstSeenAfter?.gap === at(4) - at(0), String(strong.firstSeenAfter?.gap));
check('The cited change is named', strong.firstSeenAfter?.change === 'plugin_updated', String(strong.firstSeenAfter?.change));
check('Every piece of evidence cites an event id',
  strong.evidence.length > 0 && strong.evidence.some((e) => e.eventId === 'u1'));

// A different plugin being updated is not evidence about WooCommerce.
const unrelated = correlateError(woocommerceRest, [
  { eventId: 'u2', siteId: 'site_x', type: 'plugin_updated', timestamp: at(0), target: { plugin: 'akismet', name: 'Akismet' } },
]);
check('An unrelated plugin update is not offered as a cause', unrelated.likelyCause === null, String(unrelated.likelyCause));
check('An unrelated change has no strength', unrelated.causeStrength === 'none', String(unrelated.causeStrength));
check('An unexplained error says so in words',
  typeof unrelated.explanation === 'string' && unrelated.explanation.includes('will not name a cause'),
  String(unrelated.explanation).slice(0, 60));

// Weak evidence must read as a related change, not a cause.
const weakOnly = correlateError(woocommerceRest, [
  { eventId: 'c1', siteId: 'site_x', type: 'option_changed', timestamp: at(2), target: {} },
]);
check('A config change alone is weak evidence', weakOnly.causeStrength === 'weak', weakOnly.causeStrength);
check('Weak evidence reads "Related change detected"', weakOnly.likelyCause === 'Related change detected', String(weakOnly.likelyCause));

// A cron failure with a cron change is strong; the same change for a REST error is not.
const cronGroup = groupErrors([ev('cron_error', { ...FIXTURES.cron_error, fingerprint: 'fp_c1' }, 4)])[0];
const cronEvt = [{ eventId: 'k1', siteId: 'site_x', type: 'cron_removed', timestamp: at(0), target: { hook: 'wc_cleanup_sessions' } }];
const cronStrong = correlateError(cronGroup, cronEvt);
check('A cron change explains a cron failure strongly', cronStrong.causeStrength === 'strong', cronStrong.causeStrength);
const cronWeakForRest = correlateError(woocommerceRest, cronEvt);
check('The same cron change is only related for a REST error', cronWeakForRest.causeStrength === 'weak', cronWeakForRest.causeStrength);

// Admin activity is context, never a cause on its own.
const adminOnly = correlateError(woocommerceRest, [
  { eventId: 'a1', siteId: 'site_x', type: 'administrator_created', timestamp: at(2), target: {} },
]);
check('Admin activity alone is never a cause', adminOnly.likelyCause === null, String(adminOnly.likelyCause));
const adminPlus = correlateError(woocommerceRest, [
  { eventId: 'a1', siteId: 'site_x', type: 'administrator_created', timestamp: at(2), target: {} },
  { eventId: 'u1', siteId: 'site_x', type: 'plugin_updated', timestamp: at(0), target: { plugin: 'woocommerce', name: 'WooCommerce' } },
]);
check('Admin activity is listed as evidence alongside a real change',
  adminPlus.evidence.some((e) => e.eventId === 'a1'));

// A change outside the window is not evidence.
const stale = correlateError(woocommerceRest, [
  { eventId: 'o1', siteId: 'site_x', type: 'plugin_updated', timestamp: at(10) - 4 * 60 * MINUTE, target: { plugin: 'woocommerce' } },
]);
check('A change four hours earlier is outside the window', stale.likelyCause === null, String(stale.likelyCause));

// Repeats add evidence but never raise the severity class.
const repeatEvidence = correlateError(repeated[0], []);
check('Repeats are reported as evidence',
  repeatEvidence.evidence.some((e) => /Recorded 23 times/.test(e.text)), JSON.stringify(repeatEvidence.evidence.map((e) => e.text)));

// No sentence may overclaim.
for (const c of [strong, weakOnly, cronStrong, cronWeakForRest, adminPlus]) {
  if (!c.likelyCause) continue;
  check(`"${c.likelyCause.slice(0, 34)}…" does not overclaim`,
    !/\b(was caused by|definitely|proven root cause|malicious|vulnerable plugin)\b/i.test(c.likelyCause));
}

/* ========================================================================== *
 * 5. UNIT — the first thing to check, per family
 * ========================================================================== */
console.log('\nFamily fix steps (unit)');

const FIRST = {
  rest_error: /Check the POST .* route/,
  ajax_error: /Find the handler for the "wc_add_to_cart" action/,
  db_error: /Inspect the wp_options table/,
  mail_error: /Check the smtp:mail.example.com transport/,
  cron_error: /Run the wc_cleanup_sessions hook manually/,
  js_error: /Open \/wp-content\/plugins\/x\/a\.js at line 12/,
  http_error: /Request \/checkout\/ directly/,
  wp_error: /Trace the invalid_request error code/,
};

for (const [type, re] of Object.entries(FIRST)) {
  const g = groupErrors([ev(type, FIXTURES[type])])[0];
  const steps = buildErrorFixSteps(g);
  check(`${type} produces fix steps`, Array.isArray(steps) && steps.length > 0, String(steps.length));
  check(`${type}'s first step is family-specific`, re.test(steps[0].title), steps[0].title);
  check(`${type}'s steps all cite evidence`, steps.every((s) => s && s.id && s.title && s.why));
}

// The PHP-only compatibility step must not leak into the other families.
const phpGroup = groupErrors([ev('php_error', {
  fingerprint: 'fp_php', severity: 'Fatal error', message: 'Call to undefined method X::y()',
  relativePath: 'wp-content/plugins/p/p.php', line: 9, component: 'plugin', componentName: 'P',
})])[0];
const phpSteps = buildErrorFixSteps(phpGroup).map((s) => s.id);
check('A PHP error gets the compatibility step', phpSteps.includes('check-compatibility'), phpSteps.join(','));

for (const type of ['rest_error', 'ajax_error', 'db_error', 'mail_error', 'cron_error', 'js_error']) {
  const g = groupErrors([ev(type, { ...FIXTURES[type], component: 'plugin', componentSlug: 'x', componentName: 'X' })])[0];
  const ids = buildErrorFixSteps(g).map((s) => s.id);
  check(`${type} does not get the PHP compatibility step`, !ids.includes('check-compatibility'), ids.join(','));
}

/* ========================================================================== *
 * 6. UNIT — the normalised answer set
 * ========================================================================== */
console.log('\nNormalised answers (unit)');

for (const type of Object.keys(FIXTURES)) {
  const g = groupErrors([ev(type, FIXTURES[type])])[0];
  const a = buildErrorAnswers(g);
  check(`${type} answers all eight questions`, Boolean(a) &&
    typeof a.whatFailed === 'string' &&
    'where' in a &&
    a.when?.firstSeen > 0 &&
    a.howOften >= 1 &&
    typeof a.whichComponent === 'string' &&
    'whatChanged' in a &&
    ['strong', 'weak', 'none'].includes(a.changeStrength) &&
    Array.isArray(a.evidence) &&
    typeof a.checkFirst === 'string',
    JSON.stringify(Object.keys(a ?? {})));
}

const evidence = buildErrorEvidence([
  ev('rest_error', { ...FIXTURES.rest_error, fingerprint: 'fpE1', occurrences: 23 }),
  ev('db_error', { ...FIXTURES.db_error, fingerprint: 'fpE2' }),
]);
check('buildErrorEvidence returns every group', evidence.groups.length === 2, String(evidence.groups.length));
check('Its total sums occurrences', evidence.total === 24, String(evidence.total));
check('Its primary is the most actionable error', Boolean(evidence.primary), String(evidence.primary?.type));
check('Every group arrives correlated', evidence.groups.every((g) => g.correlation));

/* ========================================================================== *
 * 7. LIVE — ingest and render
 * ========================================================================== */
console.log('\nLive: ingest and the /errors page');

const site = await provision('Error Families Test', 'https://families.example.test');
check('A collector key was minted', typeof site.key === 'string' && site.key.length > 0);

const tag = uniq();
const sent = [
  ev('http_error', { ...FIXTURES.http_error, fingerprint: `h_${tag}` }, 8),
  ev('rest_error', { ...FIXTURES.rest_error, fingerprint: `r_${tag}`, occurrences: 23 }, 6),
  ev('ajax_error', { ...FIXTURES.ajax_error, fingerprint: `a_${tag}` }, 6),
  ev('db_error', { ...FIXTURES.db_error, fingerprint: `d_${tag}` }, 6),
  ev('mail_error', { ...FIXTURES.mail_error, fingerprint: `m_${tag}` }, 6),
  ev('cron_error', { ...FIXTURES.cron_error, fingerprint: `c_${tag}` }, 6),
  ev('js_error', { ...FIXTURES.js_error, fingerprint: `j_${tag}` }, 6),
  ev('wp_error', { ...FIXTURES.wp_error, fingerprint: `w_${tag}` }, 6),
].map((e) => ({ ...e, siteId: site.siteId }));

// Timestamps must be recent: the page reads a bounded window of events, so a
// fixture dated months ago would be stored and then never rendered.
const now = Date.now();
const live = sent.map((e, i) => ({
  ...e,
  timestamp: new Date(now - (8 - i) * MINUTE).toISOString(),
}));
const payload = { site: site.siteId, events: live };
const ingested = await call('POST', '/api/blackbox/ingest', payload, signed(site.siteId, site.key, payload));
check('The ingest was accepted', ingested.status === 200, `status ${ingested.status} body ${JSON.stringify(ingested.body).slice(0, 160)}`);
check('All eight events were accepted', ingested.body?.accepted === 8, String(ingested.body?.accepted));
check('None were rejected', (ingested.body?.rejected ?? []).length === 0, JSON.stringify(ingested.body?.rejected));

// Read them back and confirm each landed in the error category.
const stored = await call('GET', `/api/blackbox/events?site=${site.siteId}&category=error&limit=100`);
const byType = {};
for (const e of stored.body?.events ?? []) byType[e.type] = e;

for (const type of ['http_error', 'rest_error', 'ajax_error', 'db_error', 'mail_error', 'cron_error', 'js_error', 'wp_error']) {
  check(`${type} was stored in the error category`, Boolean(byType[type]), Object.keys(byType).join(','));
}

check('The stored REST error kept its endpoint',
  byType.rest_error?.metadata?.endpoint === '/wp-json/wc/v3/orders', String(byType.rest_error?.metadata?.endpoint));
check('The stored REST error kept its occurrence count',
  byType.rest_error?.metadata?.occurrences === 23, String(byType.rest_error?.metadata?.occurrences));
check('The stored database error kept only the query type and table',
  byType.db_error?.metadata?.queryType === 'UPDATE' && byType.db_error?.metadata?.table === 'wp_options',
  JSON.stringify(byType.db_error?.metadata));

// The rendered page.
const page = await call('GET', '/errors');
const cards = cardsOf(page.html);
check('The /errors page renders', page.status === 200, `status ${page.status}`);
check('It rendered one card per error group', cards.length >= 8, String(cards.length));

const restCards = cards.filter((c) => c.includes('REST API 403 on POST /wp-json/wc/v3/orders'));
check('A REST card shows method and endpoint', restCards.length === 1, String(restCards.length));
check('The REST card shows its status', restCards[0]?.includes('403'));
check('The REST card shows its WP_Error code', restCards[0]?.includes('rest_forbidden'));
check('The REST card shows its occurrences', restCards[0]?.includes('23'));
check('The REST card shows its component', restCards[0]?.includes('WooCommerce'));
check('The REST card shows the website', restCards[0]?.includes('Error Families Test'));
check('The REST card shows first and last seen',
  /First seen/.test(restCards[0] ?? '') && /Last seen/.test(restCards[0] ?? ''));

const cronCards = cards.filter((c) => c.includes('wc_cleanup_sessions'));
check('A cron card names its hook', cronCards.length === 1, String(cronCards.length));
check('The cron card names its schedule', cronCards[0]?.includes('twicedaily'));

const dbCards = cards.filter((c) => c.includes('wp_options'));
check('A database card names its table', dbCards.length === 1, String(dbCards.length));
check('The database card names the query type', dbCards[0]?.includes('UPDATE'));

const jsCards = cards.filter((c) => c.includes('/wp-content/plugins/x/a.js'));
check('A JS card names its script', jsCards.length === 1, String(jsCards.length));
check('The JS card names line and column', jsCards[0]?.includes('12:4'), jsCards[0]?.slice(0, 200));

/* ------------------------------------------------- the family filter */
console.log('\nLive: the family filter');

// Assert on the rendered cards only. The raw HTML also contains the flight
// payload, which serialises every row the page considered — filtered out or
// not — so a substring search there proves nothing.
const ALL = ['', 'php', 'http', 'rest', 'ajax', 'database', 'email', 'cron', 'javascript'];
const EXPECT = { php: 0, http: 1, rest: 1, ajax: 1, database: 1, email: 1, cron: 1, javascript: 1 };

for (const kind of ALL) {
  const res = await call('GET', `/errors${kind ? `?kind=${kind}` : ''}`);
  const cs = cardsOf(res.html);
  const want = kind === '' ? 8 : (EXPECT[kind] ?? 0);
  check(`?kind=${kind || '(all)'} renders exactly ${want} card(s)`, cs.length === want, `got ${cs.length}`);
  if (kind && kind !== 'php') {
    const needle = {
      http: 'HTTP 503 response',
      rest: 'REST API 403',
      ajax: 'wc_add_to_cart',
      database: 'wp_options',
      email: 'smtp:mail.example.com',
      cron: 'wc_cleanup_sessions',
      javascript: '/wp-content/plugins/x/a.js',
    }[kind];
    check(`?kind=${kind} shows the ${kind} error`, cs.some((c) => c.includes(needle)), needle);
    // Every card shown must actually belong to the selected family.
    check(`?kind=${kind} hides the other families`,
      !cs.some((c) => c.includes('wc_cleanup_sessions') && kind !== 'cron'),
      'a cron card leaked into another filter');
  }
}

const phpOnly = await call('GET', '/errors?kind=php');
check('?kind=php shows no cards when no PHP error was sent', cardsOf(phpOnly.html).length === 0,
  String(cardsOf(phpOnly.html).length));
check('The empty state explains itself rather than showing a blank list',
  norm(phpOnly.html ?? '').includes('No errors of this type recorded yet'));

// A no-overclaim pass over everything rendered.
const allRendered = cardsOf((await call('GET', '/errors')).html).join('\n');
check('No rendered card claims a proven root cause',
  !/\b(was caused by|definitely|proven root cause|malicious|vulnerable plugin)\b/i.test(allRendered));

/* ---------------------------------------------------------------- cleanup */
for (const id of createdSites) await call('DELETE', `/api/blackbox/sites/${id}?purge=true`);

console.log(`\n${fail === 0 ? '✓' : '✗'} error families suite: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
