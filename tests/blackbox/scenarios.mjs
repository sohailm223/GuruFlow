/**
 * Incident detector regression suite.
 *
 * These scenarios are the calibration contract for the analysis engine:
 * if a collector or scoring change moves any of them into the wrong band, this
 * suite fails. It runs against a live ScanSite server.
 *
 *   node tests/blackbox/scenarios.mjs
 *
 * The previous copy of this suite lived in /tmp and was lost; it now lives in
 * the repository so it cannot be lost again.
 */

import crypto from 'crypto';

const BASE = process.env.SCANSITE_URL || 'http://127.0.0.1:3000';
const MINUTE = 60_000;

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
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** Create a site, pair a collector, return working credentials. */
/** Sites created by this run, deleted again on the way out. */
const createdSites = [];

async function provision(name) {
  const created = await call('POST', '/api/blackbox/sites', { name, url: `http://scenario-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.test`, environment: 'development' });
  const siteId = created.body.site.id;
  createdSites.push(siteId);
  const code = created.body.connection.code;
  const connected = await call('POST', '/api/blackbox/connect', { code, siteUrl: created.body.site.url });
  return { siteId, key: connected.body.collectorKey };
}

/**
 * Remove the throwaway sites. Without this the dashboard fills up with
 * duplicate "Scenario: ..." entries on every run.
 */
async function cleanup() {
  for (const id of createdSites) {
    await call('DELETE', `/api/blackbox/sites/${id}?purge=true`);
  }
}

async function ingest(siteId, key, events) {
  return call('POST', '/api/blackbox/ingest', { site: siteId, events }, (body) => signed(siteId, key, body));
}

async function incidentsFor(siteId) {
  const r = await call('GET', `/api/blackbox/incidents?site=${siteId}`);
  return r.body.incidents ?? [];
}

/* ------------------------------------------------------------- scenarios */

const scenarios = [
  {
    name: 'Routine maintenance',
    expectTitle: 'Routine maintenance',
    expectBand: 'INFO',
    // The routine detector only fires when the window contains component
    // updates and nothing suspicious, so these are plain version bumps.
    build: (t) => [
      { eventId: 'r1', type: 'plugin_updated', category: 'plugin', timestamp: new Date(t - 6 * MINUTE).toISOString(), target: { plugin: 'wordpress-seo', name: 'Yoast SEO' }, changes: { from: '23.9.1', to: '23.9.2' } },
      { eventId: 'r2', type: 'plugin_updated', category: 'plugin', timestamp: new Date(t - 5 * MINUTE).toISOString(), target: { plugin: 'redirection', name: 'Redirection' }, changes: { from: '5.4.2', to: '5.4.3' } },
    ],
  },
  {
    name: 'WooCommerce update followed by failure',
    expectTitle: 'Site broke shortly after an update',
    expectBand: 'MEDIUM',
    build: (t) => [
      { eventId: 'u1', type: 'plugin_updated', category: 'plugin', timestamp: new Date(t - 9 * MINUTE).toISOString(), target: { plugin: 'woocommerce', name: 'WooCommerce' }, changes: { from: '9.4.1', to: '9.5.0' } },
      { eventId: 'u2', type: 'site_error_burst', category: 'core', timestamp: new Date(t - 4 * MINUTE).toISOString(), metadata: { httpStatus: 500, requests: 240 } },
    ],
  },
  {
    name: 'Privilege escalation + backdoor',
    expectTitle: 'Suspicious executable after privilege escalation',
    expectBand: 'CRITICAL',
    build: (t) => [
      { eventId: 'c1', type: 'administrator_created', category: 'user', timestamp: new Date(t - 8 * MINUTE).toISOString(), actor: { username: 'support_wp', role: 'administrator', ip: '198.51.100.23' }, target: { username: 'support_wp' }, changes: { to: 'administrator' } },
      { eventId: 'c2', type: 'active_plugins_changed', category: 'db', timestamp: new Date(t - 6 * MINUTE).toISOString(), actor: { username: 'support_wp', role: 'administrator', ip: '198.51.100.23' }, target: { name: 'active_plugins' } },
      { eventId: 'c3', type: 'executable_created', category: 'file', timestamp: new Date(t - 2 * MINUTE).toISOString(), actor: { username: 'support_wp', role: 'administrator', ip: '198.51.100.23' }, path: '/wp-content/uploads/cache/x1.php', target: { name: 'x1.php', path: '/wp-content/uploads/cache/x1.php' }, metadata: { extension: '.php', executable: true } },
      { eventId: 'c4', type: 'cron_added', category: 'cron', timestamp: new Date(t - MINUTE).toISOString(), actor: { username: 'support_wp', role: 'administrator', ip: '198.51.100.23' }, target: { hook: 'wp_health_check_hourly', name: 'wp_health_check_hourly' }, metadata: { schedule: 'hourly' } },
    ],
  },
  {
    name: 'Redirect hijacking',
    expectTitle: 'Traffic or mail being redirected',
    expectBand: 'CRITICAL',
    build: (t) => [
      { eventId: 'h1', type: 'siteurl_changed', category: 'db', timestamp: new Date(t - 5 * MINUTE).toISOString(), changes: { from: 'https://shop.example.com', to: 'https://shop.example.com.evil.tld' } },
      { eventId: 'h2', type: 'home_changed', category: 'db', timestamp: new Date(t - 4 * MINUTE).toISOString(), changes: { from: 'https://shop.example.com', to: 'https://shop.example.com.evil.tld' } },
      { eventId: 'h3', type: 'redirect_created', category: 'redirect', timestamp: new Date(t - 3 * MINUTE).toISOString(), target: { name: '/ → https://evil.tld' } },
    ],
  },
  {
    name: 'Brute-force login attack',
    expectTitle: 'Login attack in progress',
    expectBand: 'MEDIUM',
    build: (t) => [
      { eventId: 'b1', type: 'login_failed_burst', category: 'auth', timestamp: new Date(t - 2 * MINUTE).toISOString(), target: { username: 'admin' }, count: 40, metadata: { windowMinutes: 5, ipCount: 7 } },
    ],
  },

  /* ---- grouping: identity, not just timing ----
   * These two pin the correlation behaviour. Both spread their events 45
   * minutes apart, far beyond the 10-minute time gap, so ONLY the identity
   * link can decide whether they land in one incident or two. */
  {
    name: 'Same actor links events 45 min apart',
    expectTitle: 'Suspicious executable after privilege escalation',
    expectBand: 'CRITICAL',
    expectCount: 1,
    build: (t) => [
      { eventId: 'g1', type: 'administrator_created', category: 'user', timestamp: new Date(t - 45 * MINUTE).toISOString(), actor: { username: 'support_wp', role: 'administrator', ip: '198.51.100.23' }, target: { username: 'support_wp' }, changes: { to: 'administrator' } },
      { eventId: 'g2', type: 'executable_created', category: 'file', timestamp: new Date(t).toISOString(), actor: { username: 'support_wp', role: 'administrator', ip: '198.51.100.23' }, path: '/wp-content/uploads/cache/x1.php', target: { name: 'x1.php', path: '/wp-content/uploads/cache/x1.php' }, metadata: { extension: '.php', executable: true } },
    ],
  },
  {
    name: 'Different actors 45 min apart stay separate',
    expectTitle: 'Unexpected administrator account',
    // A lone administrator_created (priv-esc weight 30) scores MEDIUM, not HIGH.
    expectBand: 'MEDIUM',
    expectCount: 2,
    build: (t) => [
      { eventId: 's1', type: 'administrator_created', category: 'user', timestamp: new Date(t - 45 * MINUTE).toISOString(), actor: { username: 'alice', role: 'administrator', ip: '198.51.100.10' }, target: { username: 'alice' }, changes: { to: 'administrator' } },
      { eventId: 's2', type: 'administrator_created', category: 'user', timestamp: new Date(t).toISOString(), actor: { username: 'bob', role: 'administrator', ip: '203.0.113.77' }, target: { username: 'bob' }, changes: { to: 'administrator' } },
    ],
  },
  {
    name: 'Same file path links different actors',
    expectTitle: 'Unexpected executable in uploads',
    // Two executables inside one correlated incident score higher than a single
    // one would on its own: measured CRITICAL 100.
    expectBand: 'CRITICAL',
    expectCount: 1,
    build: (t) => [
      { eventId: 'f1', type: 'executable_created', category: 'file', timestamp: new Date(t - 45 * MINUTE).toISOString(), actor: { username: 'alice', ip: '198.51.100.10' }, path: '/wp-content/uploads/cache/x1.php', target: { name: 'x1.php', path: '/wp-content/uploads/cache/x1.php' }, metadata: { extension: '.php' } },
      { eventId: 'f2', type: 'executable_created', category: 'file', timestamp: new Date(t).toISOString(), actor: { username: 'bob', ip: '203.0.113.77' }, path: '/wp-content/uploads/cache/x1.php', target: { name: 'x1.php', path: '/wp-content/uploads/cache/x1.php' }, metadata: { extension: '.php' } },
    ],
  },
  {
    name: 'Same session links different actors and IPs',
    expectTitle: 'Unexpected administrator account',
    // Correlating two administrator creations through one session is more
    // serious than a lone creation (which scores MEDIUM 53): measured CRITICAL 80.
    expectBand: 'CRITICAL',
    expectCount: 1,
    build: (t) => [
      { eventId: 'k1', type: 'administrator_created', category: 'user', timestamp: new Date(t - 45 * MINUTE).toISOString(), actor: { username: 'carol', role: 'administrator', ip: '198.51.100.31', session: 'sess_9f2a' }, target: { username: 'carol' }, changes: { to: 'administrator' } },
      { eventId: 'k2', type: 'administrator_created', category: 'user', timestamp: new Date(t).toISOString(), actor: { username: 'dave', role: 'administrator', ip: '203.0.113.90', session: 'sess_9f2a' }, target: { username: 'dave' }, changes: { to: 'administrator' } },
    ],
  },
];

/* ------------------------------------------------------------------ run */

let pass = 0;
let fail = 0;
const detail = [];

for (const s of scenarios) {
  const { siteId, key } = await provision(`Scenario: ${s.name}`);
  const now = Date.now();
  const ing = await ingest(siteId, key, s.build(now));
  if (ing.status !== 200) {
    console.log(`✗ ${s.name.padEnd(42)} ingest HTTP ${ing.status} ${JSON.stringify(ing.body).slice(0, 120)}`);
    fail++;
    continue;
  }
  const incidents = await incidentsFor(siteId);
  const top = incidents[0];
  // severity comes back lower-case from the API.
  const bandOk = !s.expectBand || String(top?.severity).toUpperCase() === s.expectBand;
  const titleOk = top && top.title === s.expectTitle;
  const countOk = s.expectCount === undefined || incidents.length === s.expectCount;
  const ok = Boolean(bandOk && titleOk && countOk);
  console.log(
    `${ok ? '✓' : '✗'} ${s.name.padEnd(42)} → ${top ? `${top.severity} ${top.riskScore}/100 "${top.title}"` : 'no incident'}` +
      (s.expectCount !== undefined ? ` [${incidents.length} incident${incidents.length === 1 ? '' : 's'}]` : '') +
      (ok ? '' : `   (expected ${s.expectBand ?? 'any band'} "${s.expectTitle}"${s.expectCount !== undefined ? `, ${s.expectCount} incident(s)` : ''})`)
  );
  if (ok) pass++;
  else fail++;
  detail.push({ scenario: s.name, expected: `${s.expectBand ?? 'any'} ${s.expectTitle}`, actual: top ? `${top.severity} ${top.title}` : null, ok });
}

await cleanup();
console.log(`\n${pass}/${scenarios.length} scenarios correct (${createdSites.length} test sites removed)`);
if (fail) process.exit(1);
process.exit(0);
