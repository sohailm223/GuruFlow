/**
 * In-memory rate limiting for the local MVP.
 *
 * Two protections:
 *  - collectorRateLimit: bounds how fast one site may hit the collector APIs.
 *  - login brute-force:  a small number of failed logins from one source locks
 *    it out for a cooling period.
 *
 * Single-instance on purpose; a multi-instance deployment would swap this for
 * a shared store. A restart resets the counters, which is acceptable for rate
 * limiting (it only needs to bound bursts).
 */

const HITS = new Map(); // key -> { count, resetAt }
const FAILS = new Map(); // ip  -> { count, resetAt, lockUntil }

function prune(map, now) {
  for (const [k, v] of map) {
    const until = v.lockUntil ?? v.resetAt;
    if (until <= now) map.delete(k);
  }
}

/** Fixed-window counter. Returns true while under the limit. */
export function hit(key, limit, windowMs) {
  const now = Date.now();
  if (HITS.size > 10_000) prune(HITS, now);
  let e = HITS.get(key);
  if (!e || e.resetAt <= now) {
    e = { count: 0, resetAt: now + windowMs };
    HITS.set(key, e);
  }
  e.count += 1;
  return e.count <= limit;
}

/** Collector endpoints: generous but bounded (300 req / 5 min per site). */
export function collectorRateLimit(siteId) {
  return hit(`collector:${siteId}`, 300, 5 * 60_000);
}

const LOGIN_MAX_FAILS = 5;
const LOGIN_WINDOW_MS = 15 * 60_000;

export function loginBlocked(ip) {
  const now = Date.now();
  const e = FAILS.get(ip ?? "");
  return Boolean(e && e.lockUntil > now);
}

export function recordLoginFailure(ip) {
  const now = Date.now();
  if (FAILS.size > 10_000) prune(FAILS, now);
  const key = ip ?? "";
  const e = FAILS.get(key) ?? { count: 0, resetAt: 0, lockUntil: 0 };
  e.count = e.resetAt > now ? e.count + 1 : 1;
  e.resetAt = now + LOGIN_WINDOW_MS;
  if (e.count >= LOGIN_MAX_FAILS) {
    e.lockUntil = now + LOGIN_WINDOW_MS;
    e.count = 0;
  }
  FAILS.set(key, e);
}

export function clearLoginFailures(ip) {
  FAILS.delete(ip ?? "");
}
