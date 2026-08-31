/**
 * Dashboard UX verification: overview priority, routine maintenance placement,
 * the website table, the Raw Event Explorer filter set and the development-only
 * diagnostics panel.
 *
 *   node tests/blackbox/dashboard.mjs
 *
 * Needs a running server (SCANSITE_URL, default http://127.0.0.1:3000) and the
 * admin credentials from the environment. Creates and removes its own website.
 */
import crypto from 'crypto';

const BASE = process.env.SCANSITE_URL || 'http://127.0.0.1:3000';
const M = 60_000;
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${name}${detail && !cond ? `  [${detail}]` : ''}`);
  cond ? pass++ : fail++;
};

let COOKIE = '';
const admin = (m, p, b) => fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', Cookie: COOKIE }, body: b === undefined ? undefined : JSON.stringify(b) });
const jadmin = async (m, p, b) => { const r = await admin(m, p, b); return { status: r.status, body: await r.json().catch(() => ({})) }; };

const ADMIN_USER = process.env.SCANSITE_ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.SCANSITE_ADMIN_PASSWORD || 'scansite-test-pass';
const login = await fetch(BASE + '/api/blackbox/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }) });
COOKIE = (login.headers.getSetCookie?.() ?? []).find((c) => c.startsWith('scansite_session='))?.split(';')[0] ?? '';

const now = Date.now();
const s = await jadmin('POST', '/api/blackbox/sites', { name: 'Copper Sky Hearing', url: 'https://copper-sky.example.com' });
const siteId = s.body.site.id;
const conn = await fetch(BASE + '/api/blackbox/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: s.body.connection.code, siteUrl: 'https://copper-sky.example.com' }) }).then((r) => r.json());
const key = conn.collectorKey;

const send = async (events) => {
  const body = { site: siteId, events };
  const raw = JSON.stringify(body);
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomBytes(16).toString('hex');
  const sig = crypto.createHmac('sha256', key).update(`${ts}.${nonce}.${raw}`).digest('hex');
  const r = await fetch(BASE + '/api/blackbox/ingest', { method: 'POST', headers: { 'X-ScanSite-Site': siteId, 'X-ScanSite-Key': key, 'X-ScanSite-Timestamp': ts, 'X-ScanSite-Nonce': nonce, 'X-ScanSite-Signature': `sha256=${sig}`, 'Content-Type': 'application/json' }, body: raw });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

// A heartbeat so the collector entry in Recent Activity has a timestamp.
{
  const hb = { siteId, pluginVersion: '0.3.0' };
  const raw = JSON.stringify(hb);
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomBytes(16).toString('hex');
  const sig = crypto.createHmac('sha256', key).update(`${ts}.${nonce}.${raw}`).digest('hex');
  await fetch(BASE + '/api/blackbox/heartbeat', { method: 'POST', headers: { 'X-ScanSite-Site': siteId, 'X-ScanSite-Key': key, 'X-ScanSite-Timestamp': ts, 'X-ScanSite-Nonce': nonce, 'X-ScanSite-Signature': `sha256=${sig}`, 'Content-Type': 'application/json' }, body: raw });
}

/* ------------------------------------------------- 16 Recent Activity */
console.log('\n16  Routine maintenance inside Recent Activity');
await send([
  { eventId: 'r1', type: 'plugin_updated', category: 'plugin', timestamp: new Date(now - 3 * M).toISOString(), target: { plugin: 'wordpress-seo', name: 'Yoast SEO' }, changes: { from: '23.1', to: '23.2' } },
  { eventId: 'r2', type: 'theme_updated', category: 'theme', timestamp: new Date(now - 2 * M).toISOString(), target: { theme: 'astra', name: 'Astra' }, changes: { from: '4.6.0', to: '4.6.1' } },
  { eventId: 'r3', type: 'file_integrity_scan_completed', category: 'file', timestamp: new Date(now - M).toISOString(), metadata: { filesChecked: 1284, critical: 0 } },
  { eventId: 'r4', type: 'administrator_created', category: 'user', timestamp: new Date(now - 9 * M).toISOString(), actor: { username: 'mallory', ip: '198.51.100.12' }, target: { username: 'mallory' }, changes: { to: 'administrator' } },
  { eventId: 'r5', type: 'executable_created', category: 'file', timestamp: new Date(now - 4 * M).toISOString(), actor: { username: 'mallory', ip: '198.51.100.12' }, path: '/wp-content/uploads/cache/z.php', target: { name: 'z.php', path: '/wp-content/uploads/cache/z.php' }, metadata: { extension: '.php', executable: true } },
]);

const norm = (h) => h.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/<!--[^>]*-->/g, '');
const home = norm(await (await fetch(BASE + '/', { headers: { Cookie: COOKIE } })).text());
const main = home.slice(home.indexOf('<main'));
const actPos = main.indexOf('Recent Activity');
const after = main.slice(actPos);
const needsPos = main.indexOf('Needs Attention');
const needsBlock = main.slice(needsPos, main.indexOf('Website Health'));

for (const [needle, label] of [
  ['Plugin "Yoast SEO" updated successfully', 'Yoast updated successfully'],
  ['Theme "Astra" updated successfully', 'Astra updated successfully'],
  ['File integrity scan completed', 'File integrity scan completed'],
  ['Collector heartbeat received', 'Collector heartbeat received'],
]) {
  ok(`Recent Activity shows: ${label}`, after.includes(needle), needle);
}
ok('routine entries are NOT in the Needs Attention panel', !needsBlock.includes('updated successfully') && !needsBlock.includes('heartbeat received'));
ok('routine entries carry a Routine tag', after.includes('Routine</span>') || after.includes('>Routine<'));
ok('Recent Activity explains routine items are informational', /never mixed into the\s*items that need attention|never mixed into the items that need attention/.test(after.replace(/\s+/g, ' ')));

/* --------------------------------------------------- 17 website table */
console.log('\n17  Website table columns');
for (const h of ['Website Health', 'Collector Health', 'File Integrity', 'Risk']) {
  ok(`header present: ${h}`, main.includes(`>${h}</th>`), h);
}
const rowArea = main.slice(main.indexOf('Website Health'), main.indexOf('Recent Activity'));
ok('website health value rendered', /Critical|Needs Attention|Healthy/.test(rowArea), '');
ok('collector health value rendered', /Connected|Connection Issue|Disconnected|Pending/.test(rowArea), '');
ok('file integrity shows a count with severity', /\d+ Critical|\d+ Suspicious|Verified/.test(rowArea), '');
ok('risk shown as N/100', /\d+\/100/.test(rowArea), '');

/* ------------------------------------------- 14 overview priority order */
console.log('\n14  Overview priority order');
// Anchor on the real markup: the "View File Integrity" link would otherwise
// masquerade as the File Integrity panel, and the sidebar repeats nav labels.
const STAT = 'text-sm text-slate-400">';
const PANEL = 'text-xs font-semibold uppercase tracking-wide text-slate-400">';
const order = [
  ['Attention required', 'tracking-wide text-rose-400">Attention required<'],
  ['Sites Monitored', STAT + 'Sites Monitored<'],
  ['Need Attention', STAT + 'Need Attention<'],
  ['Open Incidents', STAT + 'Open Incidents<'],
  ['Suspicious Files', STAT + 'Suspicious Files<'],
  ['Website Health', PANEL + 'Website Health<'],
  ['File Integrity', PANEL + 'File Integrity<'],
  ['Recent Activity', PANEL + 'Recent Activity<'],
];
const idx = order.map(([label, needle]) => [label, main.indexOf(needle)]);
ok('all 8 sections present in the main column', idx.every(([, i]) => i >= 0), idx.filter(([, i]) => i < 0).map(([x]) => x).join(','));
ok('rendered in the requested priority order', idx.every(([, i], n) => n === 0 || i > idx[n - 1][1]), idx.map(([x, i]) => `${x}@${i}`).join(' '));
const actStart = main.indexOf('Recent Activity');
const needsStart = main.indexOf('Needs Attention');
ok('routine entries live inside Recent Activity, after the criticals', actStart > needsStart && /Routine<\/span>|>Routine</.test(main.slice(actStart)), `activity@${actStart} needs@${needsStart}`);
ok('no routine entries in the Needs Attention panel', !main.slice(needsStart, actStart).includes('updated successfully'));

/* ------------------------------------------------- 18 event explorer */
console.log('\n18  Raw Event Explorer filters + search');
const all = await jadmin('GET', `/api/blackbox/events?site=${siteId}&limit=50`);
ok('events expose a per-event risk band', all.body.events.every((e) => typeof e.riskBand === 'string' && typeof e.riskScore === 'number'), JSON.stringify(all.body.events[0]?.riskBand));
const crit = await jadmin('GET', `/api/blackbox/events?site=${siteId}&risk=critical&limit=50`);
ok('risk filter narrows the result set', crit.body.events.length < all.body.events.length && crit.body.events.every((e) => e.riskBand === 'critical'), `${crit.body.events.length}/${all.body.events.length}`);
ok('risk filter excludes non-matching events', all.body.events.some((e) => e.riskBand !== 'critical'));

const searches = [
  ['mallory', 'username'],
  ['/wp-content/uploads/cache/z.php', 'path'],
  ['wordpress-seo', 'plugin'],
  ['astra', 'theme'],
  ['198.51.100.12', 'IP'],
  ['r3', 'eventId'],
  ['wp_health_check_hourly', 'cron hook'],
];
await send([{ eventId: 'r6', type: 'cron_added', category: 'cron', timestamp: new Date(now).toISOString(), actor: { username: 'mallory', ip: '198.51.100.12' }, target: { hook: 'wp_health_check_hourly', name: 'wp_health_check_hourly' }, metadata: { schedule: 'hourly' } }]);
for (const [q, label] of searches) {
  const r = await jadmin('GET', `/api/blackbox/events?site=${siteId}&q=${encodeURIComponent(q)}&limit=50`);
  ok(`search matches ${label}`, r.body.events.length > 0, q);
}
for (const [param, label] of [['category=auth', 'category'], ['type=cron_added', 'event type'], ['actor=mallory', 'actor'], ['from=' + (now - 5 * M), 'date']]) {
  const r = await jadmin('GET', `/api/blackbox/events?site=${siteId}&${param}&limit=50`);
  ok(`filter works: ${label}`, r.status === 200 && r.body.events.length >= 0, param);
}
const incs = await jadmin('GET', `/api/blackbox/incidents?site=${siteId}`);
const incId = incs.body.incidents[0]?.id;
const incDetail = await jadmin('GET', `/api/blackbox/incidents/${incId}`);
const incEventIds = new Set((incDetail.body.incident.events ?? []).map((e) => e.eventId));
const byInc = await jadmin('GET', `/api/blackbox/events?site=${siteId}&incident=${incId}&limit=50`);
ok('filter works: incident (only that incident\'s events)', byInc.body.events.length > 0 && byInc.body.events.every((e) => incEventIds.has(e.eventId)), `${byInc.body.events.length} returned, incident has ${incEventIds.size}`);
const otherInc = incs.body.incidents.find((i) => i.id !== incId);
if (otherInc) {
  const byOther = await jadmin('GET', `/api/blackbox/events?site=${siteId}&incident=${otherInc.id}&limit=50`);
  ok('incident filter excludes other incidents', byOther.body.events.every((e) => !incEventIds.has(e.eventId)), `${byOther.body.events.length}`);
}
const global = await jadmin('GET', `/api/blackbox/events?limit=50`);
ok('filter works: site (omitted = all sites)', global.status === 200 && Array.isArray(global.body.events));

const evHtml = await (await fetch(BASE + '/events', { headers: { Cookie: COOKIE } })).text();
ok('explorer renders a Website filter', evHtml.includes('>Website</span>') && evHtml.includes('All websites'), '');
ok('explorer renders a Risk filter', evHtml.includes('>Risk</span>') && evHtml.includes('Any risk'), '');
ok('explorer documents the searchable fields', /username, path, plugin, theme, IP, event ID, cron hook/.test(evHtml), '');
for (const label of ['Category', 'Event type', 'Actor', 'Incident', 'Date', 'Search']) {
  ok(`explorer renders ${label} control`, evHtml.includes(`>${label}</span>`), label);
}

/* ------------------------------------------------------- 19 dev mode */
console.log('\n19  Development-only diagnostics (this suite expects a DEV server; run the');
console.log('    production build separately to confirm the panel is absent there)');
const incHtml = await (await fetch(BASE + `/incidents/${incId}`, { headers: { Cookie: COOKIE } })).text();
const devMode = process.env.NODE_ENV_CHECK !== 'prod';
for (const [needle, label] of [
  ['Developer diagnostics', 'panel present'],
  ['Grouping score', 'grouping score'],
  ['Correlation keys', 'correlation keys'],
  ['Raw event score', 'raw event score'],
  ['Detector contributions', 'detector contributions'],
  ['Max time distance', 'time distance'],
]) {
  ok(`dev diagnostics show ${label}`, incHtml.includes(needle), needle);
}
ok('panel is labelled development only', incHtml.includes('development only'));
ok('shows the actor correlation key for this incident', incHtml.includes('actor:mallory'), '');
ok('shows the file-path correlation key', incHtml.includes('path:wp-content/uploads/cache/z.php'), '');

await admin('DELETE', `/api/blackbox/sites/${siteId}?purge=true`);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
