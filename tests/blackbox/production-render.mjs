/**
 * Production-render suite.
 *
 * The incident page mixes server components with client components
 * (HowToFix, VerifyRepair). `next dev` and `next build` do not compile or
 * hydrate those the same way, so a page that renders under the dev server is
 * not proof it renders in a production build — and developer diagnostics must
 * be absent there.
 *
 * Both halves are asserted here, against the SAME stored incident, by running
 * the dev server and a production server side by side over one JSON store.
 *
 * Requires TWO servers over the same data directory:
 *
 *   SCANSITE_ADMIN_USER=admin SCANSITE_ADMIN_PASSWORD=... SCANSITE_ALLOW_LOCAL_VERIFY=1 \
 *     npx next dev -H 0.0.0.0 -p 3000
 *   npm run build
 *   SCANSITE_ADMIN_USER=admin SCANSITE_ADMIN_PASSWORD=... SCANSITE_ALLOW_LOCAL_VERIFY=1 \
 *     npx next start -H 127.0.0.1 -p 3100
 *
 *   node tests/blackbox/production-render.mjs
 *
 * Run `npm run build` before starting the production server, or it serves a
 * stale bundle. The suite creates and deletes its own site.
 */
import crypto from 'crypto';

const DEV = 'http://127.0.0.1:3000';
const PROD = 'http://127.0.0.1:3100';

async function session(base) {
  const r = await fetch(base + '/api/blackbox/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'scansite-test-pass' }),
  });
  const c = (r.headers.getSetCookie?.() ?? []).find((s) => s.startsWith('scansite_session='));
  return c ? c.split(';')[0] : '';
}

function call(base, cookie) {
  return async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const isHtml = (res.headers.get('content-type') ?? '').includes('text/html');
    return { status: res.status, body: isHtml ? null : await res.json().catch(() => null), html: isHtml ? await res.text() : null };
  };
}

const signed = (site, key, body) => {
  const raw = JSON.stringify(body ?? {});
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomBytes(16).toString('hex');
  const sig = crypto.createHmac('sha256', key).update(`${ts}.${nonce}.${raw}`).digest('hex');
  return {
    'X-ScanSite-Site': site, 'X-ScanSite-Key': key, 'X-ScanSite-Timestamp': ts,
    'X-ScanSite-Nonce': nonce, 'X-ScanSite-Signature': `sha256=${sig}`,
  };
};

const devCookie = await session(DEV);
const prodCookie = await session(PROD);
const dev = call(DEV, devCookie);
const prod = call(PROD, prodCookie);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const norm = (h = '') => h.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/<!--[^>]*-->/g, '');

const SECTIONS = ['What Happened', 'How It Probably Happened', 'What Was Affected', 'How to Fix It', 'How to Prevent It Again'];

function checkPage(label, html, status, { verified, wantDiagnostics }) {
  check(`${label}: page renders`, status === 200 && html.includes('<main'), `status ${status}`);
  check(`${label}: all five numbered sections present`,
    [1, 2, 3, 4, 5].every((n) => html.includes(`>${n}</span>`)) && SECTIONS.every((t) => html.includes(t)));
  check(`${label}: guided fix panel present`,
    html.includes('Start Guided Fix') && html.includes('Estimated difficulty') && html.includes('Before you start: create a fresh backup'));
  check(`${label}: contextual buttons present`,
    ['View User', 'Show Fix Steps', 'Inspect File', 'How to Fix', 'View Cron'].every((b) => html.includes(b)));
  check(`${label}: verify panel in the ${verified ? 'verified' : 'pre-verification'} state`,
    verified
      ? /Re-run verification/.test(html) && html.includes('verification checks resolved') && html.includes('Remediation status')
      : /Run verification/.test(html) && html.includes('No verification has been run for this incident yet') && !html.includes('verification checks resolved'));
  check(`${label}: hedged entry-point labels`, html.includes('Possible account compromise') && html.includes('Possible plugin-related entry point'));
  check(`${label}: dev diagnostics ${wantDiagnostics ? 'present' : 'absent'}`,
    wantDiagnostics ? html.includes('Developer diagnostics') : !html.includes('Developer diagnostics'));
}

console.log('\nProduction build: incident page');
check('Logged into the production server', Boolean(prodCookie));

// Seed through the dev server; both servers share the same JSON store.
const created = await dev('POST', '/api/blackbox/sites', { name: 'Prod Render Check', url: 'https://prod-render.example.com', environment: 'development' });
const siteId = created.body?.site?.id;
const conn = await dev('POST', '/api/blackbox/connect', { code: created.body?.connection?.code, siteUrl: 'https://prod-render.example.com' });
const key = conn.body?.collectorKey;

const t0 = Date.now();
const MINUTE = 60_000;
const events = [
  { eventId: `pr_a_${crypto.randomBytes(4).toString('hex')}`, type: 'administrator_created', category: 'user', timestamp: new Date(t0 - 20 * MINUTE).toISOString(), actor: { username: 'mallory', ip: '198.51.100.12' }, target: { username: 'mallory' }, changes: { to: 'administrator' } },
  { eventId: `pr_e_${crypto.randomBytes(4).toString('hex')}`, type: 'executable_created', category: 'file', timestamp: new Date(t0 - 14 * MINUTE).toISOString(), actor: { username: 'mallory', ip: '198.51.100.12' }, path: '/wp-content/uploads/cache/z.php', target: { path: '/wp-content/uploads/cache/z.php' } },
  { eventId: `pr_c_${crypto.randomBytes(4).toString('hex')}`, type: 'cron_added', category: 'cron', timestamp: new Date(t0 - 10 * MINUTE).toISOString(), actor: { username: 'mallory', ip: '198.51.100.12' }, target: { hook: 'wp_daily_sync_task' } },
];
const payload = { site: siteId, events };
const ing = await dev('POST', '/api/blackbox/ingest', payload, signed(siteId, key, payload));
const incId = ing.body?.incidents?.[0]?.id;
check('Incident seeded', Boolean(incId), JSON.stringify(ing.body).slice(0, 160));

console.log('\nBefore any verification');
for (const [label, api, wantDiag] of [['dev', dev, true], ['production', prod, false]]) {
  const page = await api('GET', `/incidents/${incId}`);
  const html = norm(page.html ?? '');
  checkPage(label, html, page.status, { verified: false, wantDiagnostics: wantDiag });
  check(`${label}: evidence citation rendered`, html.includes('Reason:') && html.includes(events[0].eventId));
}

console.log('\nAfter a verification run on the production server');
const v = await prod('POST', `/api/blackbox/incidents/${incId}/verify`);
check('production: POST /verify works', v.status === 200 && Array.isArray(v.body?.verification?.results), `status ${v.status}`);
check('production: results carry the decision rule', (v.body?.verification?.results ?? []).every((r) => typeof r.how === 'string' && r.how.length > 10));
check('production: remediation status recorded', typeof v.body?.incident?.remediationStatus === 'string');

for (const [label, api, wantDiag] of [['dev', dev, true], ['production', prod, false]]) {
  const page = await api('GET', `/incidents/${incId}`);
  checkPage(label, norm(page.html ?? ''), page.status, { verified: true, wantDiagnostics: wantDiag });
}

await dev('DELETE', `/api/blackbox/sites/${siteId}?purge=true`);
console.log(`\n${fail === 0 ? '✓' : '✗'} production render: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
