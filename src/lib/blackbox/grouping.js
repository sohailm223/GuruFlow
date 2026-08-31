/**
 * Incident grouping.
 *
 * Events for one site are clustered into incidents by TWO links:
 *   1. time   — events close together (<= gapMinutes) belong together, and
 *   2. identity — events sharing a correlation key (actor / IP / user / account /
 *      plugin / theme / cron hook / target) within the correlation window belong
 *      together even if unrelated activity sits between them.
 *
 * When an event carries no correlation keys the time link is the only one that
 * can fire, so behaviour degrades gracefully to the original time-based grouping.
 */

import { correlationKeys } from "./correlation";

export const GROUPING_DEFAULTS = {
  gapMinutes: 10,
  maxWindowHours: 6,
};

/**
 * @param {Array} events  normalised events for a single site
 * @returns {Array<Array>} groups of events, oldest first
 */
export function groupIntoIncidents(events, opts = {}) {
  const { gapMinutes, maxWindowHours } = { ...GROUPING_DEFAULTS, ...opts };
  const gapMs = gapMinutes * 60_000;
  const windowMs = maxWindowHours * 3_600_000;
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
  const n = sorted.length;

  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a, b) => {
    parent[find(a)] = find(b);
  };

  const keyLast = new Map(); // correlation key -> most recent index carrying it

  for (let i = 0; i < n; i++) {
    const e = sorted[i];

    // Time link: chain to the immediately preceding event when close enough.
    if (i > 0 && e.timestamp - sorted[i - 1].timestamp <= gapMs) union(i, i - 1);

    // Identity link: join any earlier event within the window that shares a key.
    const keys = correlationKeys(e);
    for (const k of keys) {
      const j = keyLast.get(k);
      if (j !== undefined && e.timestamp - sorted[j].timestamp <= windowMs) union(i, j);
      keyLast.set(k, i);
    }
  }

  const byRoot = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!byRoot.has(r)) byRoot.set(r, []);
    byRoot.get(r).push(sorted[i]);
  }

  return [...byRoot.values()]
    .map((g) => g.sort((a, b) => a.timestamp - b.timestamp))
    .sort((a, b) => a[0].timestamp - b[0].timestamp);
}

/**
 * Decide which stored incident a new event belongs to, so a slow trickle of
 * events extends an existing incident instead of creating a new one each time.
 */
export function findOpenIncident(existingIncidents, event, opts = {}) {
  const { gapMinutes } = { ...GROUPING_DEFAULTS, ...opts };

  return (
    existingIncidents.find(
      (incident) =>
        incident.siteId === event.siteId &&
        incident.status !== "resolved" &&
        incident.endedAt &&
        event.timestamp - incident.endedAt <= gapMinutes * 60_000 &&
        event.timestamp >= incident.startedAt - gapMinutes * 60_000
    ) ?? null
  );
}
