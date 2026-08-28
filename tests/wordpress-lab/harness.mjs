/**
 * Shared harness for real-WordPress collector validation.
 *
 * Every test here performs a genuine WordPress action inside a real WordPress
 * installation running on real PHP, then observes what the real collector
 * plugin queued and delivered.
 */
import { boot, wp } from './runtime.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

export const LAB = dirname(fileURLToPath(import.meta.url));
export const REPO = join(LAB, '..', '..');
export const SCANSITE = process.env.SCANSITE_URL || 'http://127.0.0.1:3000';
export const WP_ENDPOINT = process.env.WP_ENDPOINT || SCANSITE;

/* ----------------------------------------------------------------- results */

export const results = {
  environment: {},
  connection: [],
  matrix: [],
  queue: [],
  privacy: [],
  performance: [],
  bugs: [],
};

/** Record one row of the real-WordPress validation matrix. */
export function matrix(event, row) {
  results.matrix.push({ event, ...row });
  const flag = row.detected === 'Yes' && row.payloadCorrect === 'Yes' ? '✓' : '✗';
  console.log(
    `  ${flag} ${event.padEnd(28)} tested=${row.tested} detected=${row.detected} ` +
      `payload=${row.payloadCorrect} dupes=${row.duplicates ?? '-'} ${row.notes || ''}`
  );
}

export function note(group, name, pass, detail) {
  const entry = { name, pass, detail };
  (results[group] ||= []).push(entry);
  console.log(`  ${pass ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

export function bug(id, description, fix) {
  results.bugs.push({ id, description, fix });
  console.log(`  ! BUG ${id}: ${description}`);
}

/* --------------------------------------------------------------- PHP side */

/**
 * Run PHP inside real WordPress and parse @@LABEL@@json@@END@@ markers.
 *
 * @param {object} php booted PHP instance
 * @param {string} body PHP statements (no opening tag)
 * @returns {Promise<{markers: Record<string, any>, text: string, errors: string}>}
 */
export async function phpRun(php, body, { admin = false } = {}) {
  let res;
  try {
    res = await wp(php, body, { labDir: LAB, admin });
  } catch (e) {
    // A PHP fatal surfaces as a thrown PHPExecutionFailureError carrying the
    // response. Report it plainly instead of an opaque stack.
    const detail = e?.response?.errors || e?.message || String(e);
    throw new Error(`PHP fatal during run: ${String(detail).slice(0, 800)}`);
  }
  const markers = {};
  const re = /@@([A-Za-z0-9_]+)@@([\s\S]*?)@@END@@/g;
  let m;
  let plain = res.text || '';
  while ((m = re.exec(res.text || '')) !== null) {
    try {
      markers[m[1]] = JSON.parse(m[2]);
    } catch {
      markers[m[1]] = m[2];
    }
    plain = plain.replace(m[0], '');
  }
  return { markers, text: plain.trim(), errors: res.errors || '', exitCode: res.exitCode };
}

/** PHP snippet that reports the current queue. */
export const QUEUE_SNIPPET = 'lab_dump_queue();';

/** Read the collector queue as parsed by phpRun. */
export async function queue(php) {
  const r = await phpRun(php, QUEUE_SNIPPET);
  return r.markers.QUEUE || [];
}

/** Clear the queue. */
export async function clearQueue(php) {
  await phpRun(php, 'lab_clear_queue();');
}

/** Run the collector's real WP-Cron flush path. */
export async function flush(php) {
  return phpRun(php, 'lab_flush(); lab_dump("state", array(ScanSite_BB_Connection::state(), ScanSite_BB_Connection::last_error())); lab_dump_queue();');
}

/* ------------------------------------------------------------ ScanSite API */

async function call(method, path, body, headers = {}) {
  const res = await fetch(SCANSITE + path, {
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
  return { status: res.status, body: json, headers: res.headers };
}

export const api = {
  health: () => call('GET', '/api/blackbox/sites'),
  createSite: (name, url) => call('POST', '/api/blackbox/sites', { name, url, environment: 'development' }),
  getSite: (id) => call('GET', `/api/blackbox/sites/${id}`),
  reconnect: (id) => call('POST', `/api/blackbox/sites/${id}/reconnect`),
  disconnect: (id) => call('POST', `/api/blackbox/sites/${id}/disconnect`),
  verifySite: (id) => call('POST', `/api/blackbox/sites/${id}/verify`),
  events: (id) => call('GET', `/api/blackbox/events?site=${id}&limit=500`),
  incidents: (id) => call('GET', `/api/blackbox/incidents?siteId=${id}`),
  incident: (id) => call('GET', `/api/blackbox/incidents/${id}`),
};

/** Fail loudly if ScanSite is not running — every test depends on it. */
export async function requireScanSite() {
  try {
    const r = await api.health();
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    return r;
  } catch (e) {
    throw new Error(`ScanSite is not reachable at ${SCANSITE} (${e.message}). Start it first: npm run dev`);
  }
}

/* ------------------------------------------------------------------ output */

export function saveResults(name = 'results.json') {
  const out = join(LAB, name);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(results, null, 2));
  console.log(`\nResults written to ${out}`);
}

export function summary() {
  const total = results.matrix.length;
  const good = results.matrix.filter((r) => r.detected === 'Yes' && r.payloadCorrect === 'Yes').length;
  console.log('\n' + '='.repeat(72));
  console.log(`Real WordPress event matrix: ${good}/${total} fully validated`);
  console.log(`Bugs found and fixed: ${results.bugs.length}`);
  console.log('='.repeat(72));
}
