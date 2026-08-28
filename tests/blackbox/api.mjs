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

import crypto from 'crypto';

const BASE = process.env.SCANSITE_URL || 'http://127.0.0.1:3000';
const MINUTE = 60_000;

/* Mandatory dashboard auth + required HMAC signing (mirror of the server). */
const ADMIN_USER = process.env.SCANSITE_ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.SCANSITE_ADMIN_PASSWORD || 'scansite-test-pass';
let ADMIN_COOKIE = '';

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
  const setc = r.headers.getSetCookie?.() ?? [];
  const c = setc.find((s) => s.startsWith('scansite_session='));
  if (c) ADMIN_COOKIE = c.split(';')[0];
}

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
  if (typeof headers === 'function') headers = headers(body);
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(ADMIN_COOKIE ? { Cookie: ADMIN_COOKIE } : {}),
      ...headers,
    },
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

const H = (body) => signed(siteId, key, body);
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

const H2 = (body) => signed(siteId, key2, body);
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

/* --------------------------------------- hardening: request shaping */
console.log('\nHardening: body limits, field caps, trusted files, notes, audit');

const oversized = {
  site: siteId,
  events: [{ eventId: `evt_${unique()}`, type: 'plugin_activated', metadata: { blob: 'x'.repeat(1_200_000) } }],
};
const tooBig = await call('POST', '/api/blackbox/ingest', oversized, H2);
check('Oversized body -> 413', tooBig.status === 413, `got ${tooBig.status}`);

const longPathEvent = {
  eventId: `evt_${unique()}`,
  type: 'file_modified',
  category: 'file',
  timestamp: new Date().toISOString(),
  path: '/wp-content/' + 'a'.repeat(5000) + '.php',
  metadata: { a: { b: { c: { d: { e: { f: { g: { h: { i: 'too deep' } } } } } } } }, long: 'y'.repeat(5000) },
};
const capped = await call('POST', '/api/blackbox/ingest', { site: siteId, events: [longPathEvent] }, H2);
check('Oversized-field event still accepted (it is capped, not rejected)', capped.status === 200, `got ${capped.status}`);

const readBack = await call('GET', `/api/blackbox/events?site=${siteId}&type=file_modified&limit=5`);
const stored = (readBack.body?.events ?? []).find((e) => e.eventId === longPathEvent.eventId);
check('Long path is truncated on ingest', Boolean(stored) && stored.path.length <= 2000, `len=${stored?.path?.length}`);
check('Long metadata string is truncated on ingest', Boolean(stored) && String(stored.metadata?.long ?? '').length <= 2000, `len=${stored?.metadata?.long?.length}`);

const depthOf = (v) => (v && typeof v === 'object' ? 1 + Math.max(0, ...Object.values(v).map(depthOf)) : 0);
check('Metadata depth is capped at 4 levels', Boolean(stored) && depthOf(stored.metadata) <= 5, `depth=${stored ? depthOf(stored.metadata) : 'n/a'}`);
check('Deeply nested metadata does not survive past the cap', !JSON.stringify(stored?.metadata ?? {}).includes('too deep'));

/* ------------------------------------------------- trusted files */
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const trustedPath = 'wp-content/themes/twentytwentyfour/functions.php';
const shaA = sha('clean-content-v1');
const shaB = sha('tampered-content-v2');

const badTrust = await call('POST', `/api/blackbox/sites/${siteId}/files/trusted`, { relativePath: trustedPath, sha256: 'not-a-hash' });
check('Trusted file with an invalid hash -> 400', badTrust.status === 400, `got ${badTrust.status}`);

const addTrust = await call('POST', `/api/blackbox/sites/${siteId}/files/trusted`, { relativePath: trustedPath, sha256: shaA, reason: 'Verified against WordPress.org release' });
check('Trusted file created', addTrust.status === 201 && addTrust.body?.trusted?.sha256 === shaA, `got ${addTrust.status}`);

const listTrust = await call('GET', `/api/blackbox/sites/${siteId}/files/trusted`);
check('Trusted file listed', (listTrust.body?.trusted ?? []).some((t) => t.relativePath === trustedPath));

const fileEvent = (sha256) => ({
  eventId: `evt_${unique()}`,
  type: 'file_modified',
  category: 'file',
  timestamp: new Date().toISOString(),
  path: `/${trustedPath}`,
  metadata: {
    file: {
      relativePath: trustedPath,
      filename: 'functions.php',
      extension: 'php',
      category: 'theme',
      sha256,
      size: 1234,
      integrityStatus: 'modified',
      riskScore: 55,
      confidence: 60,
      firstSeenAt: Date.now(),
      lastSeenAt: Date.now(),
      modifiedAt: Date.now(),
    },
  },
});

await call('POST', '/api/blackbox/ingest', { site: siteId, events: [fileEvent(shaA)] }, H2);
let filesNow = await call('GET', `/api/blackbox/sites/${siteId}/files?search=functions.php`);
let f = (filesNow.body?.files ?? []).find((x) => x.relativePath === trustedPath);
check('Trusted hash marks the file verified', f?.trusted === true && f?.integrityStatus === 'verified', `trusted=${f?.trusted} status=${f?.integrityStatus}`);
check('Trusted file risk is held down', (f?.riskScore ?? 99) <= 10, `risk=${f?.riskScore}`);

await call('POST', '/api/blackbox/ingest', { site: siteId, events: [fileEvent(shaB)] }, H2);
filesNow = await call('GET', `/api/blackbox/sites/${siteId}/files?search=functions.php`);
f = (filesNow.body?.files ?? []).find((x) => x.relativePath === trustedPath);
check('Hash change expires the trust', f?.trustedExpired === true && f?.trusted !== true, `trustedExpired=${f?.trustedExpired}`);
check('Previous hash is recorded when trust expires', f?.previousSha256 === shaA, `prev=${f?.previousSha256?.slice(0, 12)}`);

const trustAfter = await call('GET', `/api/blackbox/sites/${siteId}/files/trusted`);
check('Expired trust entry is flagged, not silently kept', (trustAfter.body?.trusted ?? []).some((t) => t.relativePath === trustedPath && t.expired === true));

/* ---------------------------------------------- notes + false positive */
const noteOnly = inc ? await call('PATCH', `/api/blackbox/incidents/${inc.id}`, { note: 'Checked the plugin changelog; nothing matches.' }) : { status: 0 };
check('Note can be added without changing status', noteOnly.status === 200 && noteOnly.body?.incident?.notes?.length === 1, `got ${noteOnly.status}`);
check('Note keeps the previous status', noteOnly.body?.incident?.status === 'investigating', noteOnly.body?.incident?.status);

const secondNote = inc ? await call('PATCH', `/api/blackbox/incidents/${inc.id}`, { note: 'Second note' }) : { status: 0 };
check('Notes are append-only', secondNote.body?.incident?.notes?.length === 2, `len=${secondNote.body?.incident?.notes?.length}`);

const fpNoReason = inc ? await call('PATCH', `/api/blackbox/incidents/${inc.id}`, { status: 'false_positive' }) : { status: 0 };
check('False positive without a reason -> 400', fpNoReason.status === 400, `got ${fpNoReason.status}`);

const fpWithReason = inc
  ? await call('PATCH', `/api/blackbox/incidents/${inc.id}`, { status: 'false_positive', falsePositiveReason: 'Known plugin/theme behaviour' })
  : { status: 0 };
check('False positive with a reason accepted', fpWithReason.status === 200 && fpWithReason.body?.incident?.falsePositiveReason === 'Known plugin/theme behaviour', `got ${fpWithReason.status}`);

/* ---------------------------------------------------------- audit log */
const anonAudit = await fetch(BASE + '/api/blackbox/audit');
check('Audit log requires a session', anonAudit.status === 401, `got ${anonAudit.status}`);

const audit = await call('GET', '/api/blackbox/audit?limit=200');
const actions = new Set((audit.body?.entries ?? []).map((e) => e.action));
check('Audit log readable by an admin', audit.status === 200 && Array.isArray(audit.body?.entries));
check('Audit records admin login', actions.has('login'), [...actions].join(','));
check('Audit records site creation', (audit.body?.entries ?? []).some((e) => e.action === 'site_added' && e.siteId === siteId));
check('Audit records incident status change', actions.has('incident_status') || actions.has('incident_note'), [...actions].join(','));
check('Audit records false positives', actions.has('incident_false_positive'), [...actions].join(','));
check('Audit records trusted-file changes', actions.has('trusted_file_added'), [...actions].join(','));

const removeTrust = await call('DELETE', `/api/blackbox/sites/${siteId}/files/trusted?id=${addTrust.body?.trusted?.id}`);
check('Trusted file can be removed', removeTrust.status === 200 && removeTrust.body?.removed === true, `got ${removeTrust.status}`);

/* ------------------------------------------ rate limiting (in-memory) */
const { hit } = await import('../../src/lib/blackbox/ratelimit.js');
const rlKey = `unit:${unique()}`;
const allowed = Array.from({ length: 300 }, () => hit(rlKey, 300, 60_000)).filter(Boolean).length;
check('Collector limiter allows exactly 300 per window', allowed === 300, `allowed=${allowed}`);
check('Collector limiter blocks the 301st request', hit(rlKey, 300, 60_000) === false);

const afterMany = await call('POST', '/api/blackbox/heartbeat', { siteId, pluginVersion: '0.2.0' }, H2);
check('Collector endpoints still work under the limit', afterMany.status === 200, `got ${afterMany.status}`);

/* ------------------------------------------------------- cleanup */
// Remove the throwaway site, otherwise every run leaves another
// "API Suite" entry cluttering the dashboard.
await call('DELETE', `/api/blackbox/sites/${siteId}?purge=true`);

/* ------------------------------------------- opt-in: HTTP 429 proof
 * These two prove the limits over the wire. They are opt-in because both are
 * disruptive by design:
 *   SCANSITE_TEST_RATELIMIT=1  sends 301 collector requests (slow)
 *   SCANSITE_TEST_LOCKOUT=1    locks the admin login out for 15 minutes
 * Run them deliberately, not on every pass.
 */
if (process.env.SCANSITE_TEST_RATELIMIT === '1') {
  console.log('\nOpt-in: collector rate limit over HTTP');
  const probe = await call('POST', '/api/blackbox/sites', { name: 'Rate limit probe', url: 'https://rate-limit-probe.example.com' });
  const rlSite = probe.body?.site?.id;
  const paired = await call('POST', '/api/blackbox/connect', { code: probe.body?.connection?.code, siteUrl: 'https://rate-limit-probe.example.com' });
  const rlKey2 = paired.body?.collectorKey;
  let blocked = 0;
  for (let i = 0; i < 305; i++) {
    const body = { site: rlSite, status: 'ok' };
    const r = await call('POST', '/api/blackbox/heartbeat', body, signed(rlSite, rlKey2, body));
    if (r.status === 429) blocked++;
  }
  check('Collector is throttled with 429 past the limit', blocked > 0, `429s=${blocked}`);
  await call('DELETE', `/api/blackbox/sites/${rlSite}?purge=true`);
} else {
  console.log('\n(skipped HTTP rate-limit probe — set SCANSITE_TEST_RATELIMIT=1)');
}

if (process.env.SCANSITE_TEST_LOCKOUT === '1') {
  console.log('\nOpt-in: login brute-force protection');
  for (let i = 0; i < 5; i++) {
    await fetch(BASE + '/api/blackbox/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: ADMIN_USER, password: 'deliberately-wrong' }),
    });
  }
  const locked = await fetch(BASE + '/api/blackbox/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
  });
  check('Correct password is refused while locked out', locked.status === 429, `got ${locked.status}`);
  const lockedBody = await locked.json().catch(() => ({}));
  check('Lockout says why', /too many|locked|try again/i.test(lockedBody?.error ?? ''), lockedBody?.error);
} else {
  console.log('\n(skipped brute-force probe — set SCANSITE_TEST_LOCKOUT=1; it locks the login for 15 min)');
}

/* ------------------------------------------------------- summary */
console.log(`\n${pass}/${pass + fail} assertions passed (test site removed)`);
if (fail) {
  console.log(`Failures: ${failures.join('; ')}`);
  process.exit(1);
}
process.exit(0);
