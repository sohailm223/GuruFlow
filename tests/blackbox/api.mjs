/**
 * Black Box API regression suite.
 *
 * Covers the collector contract and the error strings the WordPress plugin
 * depends on verbatim, plus risk-band and confidence labelling. Runs against a
 * live ScanSite server.
 *
 *   node tests/blackbox/api.mjs
 *
 * The previous copy of this suite lived in /tmp and was lost; it now lives in
 * the repository. The assertions are equivalent to, not byte-identical with,
 * the earlier version.
 */

const BASE = process.env.SCANSITE_URL || 'http://127.0.0.1:3000';
const MINUTE = 60_000;

let pass = 0;
let fail = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function call(method, path, body, headers = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/* ------------------------------------------------------------- websites */
console.log('\nWebsites and pairing');

const site = await call('POST', '/api/blackbox/sites', { name: 'API Suite', url: 'https://Api-Suite.Example.com/some/path/', environment: 'production' });
check('POST /sites returns 201', site.status === 201, `got ${site.status}`);
const siteId = site.body?.site?.id;
const code = site.body?.connection?.code;
check('Site URL is normalized (lowercased, path and trailing slash stripped)', site.body?.site?.url === 'https://api-suite.example.com', site.body?.site?.url);
check('New site starts pending', site.body?.site?.connectionStatus === 'pending');
check('Pairing code is 8 chars in XXXX-XXXX form', typeof code === 'string' && /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code), String(code));
check('Pairing code excludes ambiguous characters', !/[IO01]/.test(code || ''), String(code));
check('No collector key exists before pairing', !JSON.stringify(site.body).includes('sk_bb_'));

/* --------------------------------------------------------- connect */
console.log('\nConnection');

const connected = await call('POST', '/api/blackbox/connect', { code, siteUrl: 'https://api-suite.example.com' });
check('POST /connect returns 200', connected.status === 200, `got ${connected.status}`);
const key = connected.body?.collectorKey;
check('Collector key issued once', typeof key === 'string' && key.startsWith('sk_bb_') && key.length > 40, `len=${key?.length}`);

const replay = await call('POST', '/api/blackbox/connect', { code, siteUrl: 'https://api-suite.example.com' });
check('Pairing code is single-use', replay.status === 400, `got ${replay.status}`);
check('Replay message is explicit', /already been used/i.test(replay.body?.error || ''), replay.body?.error);

const bogus = await call('POST', '/api/blackbox/connect', { code: 'ZZZZ-9999', siteUrl: 'https://api-suite.example.com' });
check('Unknown pairing code rejected', bogus.status === 400, `got ${bogus.status}`);

const afterConnect = await call('GET', `/api/blackbox/sites/${siteId}`);
check('Site becomes connected', afterConnect.body?.site?.connectionStatus === 'connected');
check('GET never returns the raw key', !JSON.stringify(afterConnect.body).includes('sk_bb_'));
check('GET masks the key', /•/.test(JSON.stringify(afterConnect.body)), afterConnect.body?.connection?.keyDisplay);

/* ------------------------------------------------------- ingest auth */
console.log('\nIngest authentication (messages the collector depends on verbatim)');

const H = { 'X-ScanSite-Site': siteId, 'X-ScanSite-Key': key };
const event = { eventId: `evt_${unique()}`, type: 'plugin_activated', category: 'plugin', timestamp: new Date().toISOString() };

const okIngest = await call('POST', '/api/blackbox/ingest', { site: siteId, events: [event] }, H);
check('Valid ingest accepted', okIngest.status === 200 && okIngest.body?.accepted === 1, JSON.stringify(okIngest.body).slice(0, 120));

const noHeaders = await call('POST', '/api/blackbox/ingest', { site: siteId, events: [event] });
check('Missing credentials -> 401', noHeaders.status === 401, `got ${noHeaders.status}`);
check('Missing credentials message', noHeaders.body?.error === 'Missing collector credentials', noHeaders.body?.error);

const unknownSite = await call('POST', '/api/blackbox/ingest', { site: 'site_nope', events: [event] }, { 'X-ScanSite-Site': 'site_nope', 'X-ScanSite-Key': key });
check('Unknown site -> 401', unknownSite.status === 401, `got ${unknownSite.status}`);
check('Unknown site message', unknownSite.body?.error === 'Unknown site', unknownSite.body?.error);

const badKey = await call('POST', '/api/blackbox/ingest', { site: siteId, events: [event] }, { 'X-ScanSite-Site': siteId, 'X-ScanSite-Key': 'sk_bb_wrong' });
check('Bad key -> 401', badKey.status === 401, `got ${badKey.status}`);
check('Bad key message', badKey.body?.error === 'Invalid collector credentials', badKey.body?.error);

const dup = await call('POST', '/api/blackbox/ingest', { site: siteId, events: [event] }, H);
check('Duplicate eventId is not re-accepted', dup.body?.duplicates === 1 && dup.body?.accepted === 0, JSON.stringify(dup.body).slice(0, 120));

const badType = await call('POST', '/api/blackbox/ingest', { site: siteId, events: [{ eventId: `evt_${unique()}`, type: 'not_a_real_type' }] }, H);
check('All-invalid batch -> 400', badType.status === 400, `got ${badType.status}`);
check('Invalid batch message', /no valid events/i.test(badType.body?.error || ''), badType.body?.error);

const partial = await call('POST', '/api/blackbox/ingest', { site: siteId, events: [{ eventId: `evt_${unique()}`, type: 'plugin_activated' }, { eventId: `evt_${unique()}`, type: 'nope' }] }, H);
check('Partial batch accepts the valid events', partial.body?.accepted === 1, JSON.stringify(partial.body).slice(0, 120));
check('Partial batch reports which events were rejected', Array.isArray(partial.body?.rejected) && partial.body.rejected.length === 1, JSON.stringify(partial.body?.rejected));

// The `site is required` rule lives in normalizeBatch. Over HTTP it cannot
// fire, because the authenticated X-ScanSite-Site header supplies the site
// before the body is read — so the body's site field is treated as redundant.
// Assert the rule where it actually lives.
const { normalizeBatch } = await import('../../src/lib/blackbox/schemas.js');
check('Missing site -> rejected by normalizeBatch', normalizeBatch({ events: [event] }).error === 'site is required', normalizeBatch({ events: [event] }).error);
check('Body without site still ingests over HTTP (header is authoritative)', (await call('POST', '/api/blackbox/ingest', { events: [{ ...event, eventId: `evt_${unique()}` }] }, H)).status === 200);

/* ------------------------------------------------------- disconnect */
console.log('\nDisconnect and recovery');

await call('POST', `/api/blackbox/sites/${siteId}/disconnect`);
const disabled = await call('POST', '/api/blackbox/ingest', { site: siteId, events: [event] }, H);
check('Disconnected site -> 403', disabled.status === 403, `got ${disabled.status}`);
check('Disconnected message', disabled.body?.error === 'Website connection disabled', disabled.body?.error);

const re = await call('POST', `/api/blackbox/sites/${siteId}/reconnect`);
check('Reconnect issues a new pairing code', /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(re.body?.connection?.code || ''), String(re.body?.connection?.code));
const reconnected = await call('POST', '/api/blackbox/connect', { code: re.body.connection.code, siteUrl: 'https://api-suite.example.com' });
const key2 = reconnected.body?.collectorKey;
check('Reconnect returns a new key', typeof key2 === 'string' && key2 !== key);
const oldKeyRejected = await call('POST', '/api/blackbox/ingest', { site: siteId, events: [event] }, H);
check('Rotated key invalidates the old one', oldKeyRejected.status === 401, `got ${oldKeyRejected.status}`);

/* ------------------------------------------------------- heartbeat */
console.log('\nHeartbeat and verification');

const H2 = { 'X-ScanSite-Site': siteId, 'X-ScanSite-Key': key2 };
const hb = await call('POST', '/api/blackbox/heartbeat', { siteId, pluginVersion: '0.2.0', wordpressVersion: '6.8.3', phpVersion: '8.3.32' }, H2);
check('Heartbeat accepted', hb.status === 200 && hb.body?.success === true, `got ${hb.status}`);
check('Heartbeat reports health', typeof hb.body?.health?.label === 'string', JSON.stringify(hb.body?.health));

const testEvent = { eventId: `evt_test_${unique()}`, type: 'collector_test', category: 'core', timestamp: new Date().toISOString(), message: 'api suite' };
const verify = await call('POST', '/api/blackbox/verify', testEvent, H2);
check('Verify accepts a test event', verify.status === 200 && verify.body?.success === true, `got ${verify.status}`);
const siteVerify = await call('POST', `/api/blackbox/sites/${siteId}/verify`);
check('Site verify confirms receipt', siteVerify.status === 200, `got ${siteVerify.status}`);

/* ------------------------------------------------------- incidents */
console.log('\nIncidents');

const incidents = await call('GET', `/api/blackbox/incidents?site=${siteId}`);
check('Incidents list returns 200', incidents.status === 200, `got ${incidents.status}`);
const inc = (incidents.body?.incidents || [])[0];
check('Incident has riskScore and rawScore', inc ? Number.isFinite(inc.riskScore) && Number.isFinite(inc.rawScore) : false);
check('riskScore is within 0-100', inc ? inc.riskScore >= 0 && inc.riskScore <= 100 : false);

const badStatus = inc ? await call('PATCH', `/api/blackbox/incidents/${inc.id}`, { status: 'not_a_status' }) : { status: 0 };
check('Invalid incident status rejected', badStatus.status === 400, `got ${badStatus.status}`);
const goodStatus = inc ? await call('PATCH', `/api/blackbox/incidents/${inc.id}`, { status: 'investigating' }) : { status: 0 };
check('Valid incident status accepted', goodStatus.status === 200 && goodStatus.body?.incident?.status === 'investigating', `got ${goodStatus.status}`);

/* ------------------------------------------------------- scoring bands */
console.log('\nRisk bands and confidence labels');

const bands = [
  [0, 'info'], [19, 'info'], [20, 'low'], [39, 'low'], [40, 'medium'],
  [59, 'medium'], [60, 'high'], [79, 'high'], [80, 'critical'], [100, 'critical'],
];
const { severityFromScore, confidenceLabel } = await import('../../src/lib/blackbox/confidence.js');

for (const [score, expected] of bands) {
  // severityFromScore returns { severity, label }.
  const got = severityFromScore(score).severity;
  check(`score ${score} -> ${expected.toUpperCase()}`, got === expected, `got ${got}`);
}

const confidences = [[100, /highly likely/i], [90, /highly likely/i], [89, /likely/i], [70, /likely/i], [69, /possible/i], [50, /possible/i], [49, /uncertain/i], [0, /uncertain/i]];
for (const [c, re] of confidences) {
  check(`confidence ${c}% -> ${re.source}`, re.test(confidenceLabel(c)), `got ${confidenceLabel(c)}`);
}

/* ------------------------------------------------------- summary */
console.log(`\n${pass}/${pass + fail} assertions passed`);
if (fail) {
  console.log(`Failures: ${failures.join('; ')}`);
  process.exit(1);
}
process.exit(0);
