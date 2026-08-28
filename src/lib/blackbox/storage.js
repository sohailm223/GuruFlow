/**
 * ScanSite Black Box — storage layer.
 *
 * The ONLY module in the app that touches persistence. Nothing else may read
 * or write JSON files directly, so this driver can be swapped for PostgreSQL
 * (or anything else) without changing the analysis engine or the UI.
 *
 * Driver: JSON files under /data/blackbox, with an automatic in-memory
 * fallback when the filesystem is not writable (read-only containers, etc.).
 *
 * Every function is async so a database driver can be dropped in unchanged.
 */

import { promises as fs } from "fs";
import path from "path";

const DATA_DIR =
  process.env.BLACKBOX_DATA_DIR || path.join(process.cwd(), "data", "blackbox");

const FILES = {
  sites: path.join(DATA_DIR, "sites.json"),
  events: path.join(DATA_DIR, "events.json"),
  incidents: path.join(DATA_DIR, "incidents.json"),
  connections: path.join(DATA_DIR, "connections.json"),
};

const LIMITS = {
  events: 5000, // keep the newest N events
  incidents: 1000,
};

/* ------------------------------------------------------------------ *
 * Driver plumbing
 * ------------------------------------------------------------------ */

/** In-memory fallback store, keyed by collection name. */
const memory = new Map();
let usingMemory = false;

/** Serialises writes per file so concurrent requests cannot interleave. */
const locks = new Map();

function withLock(key, fn) {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(
    key,
    next.catch(() => {})
  );
  return next;
}

export function storageInfo() {
  return { driver: usingMemory ? "memory" : "json-file", dir: DATA_DIR };
}

async function readCollection(name) {
  if (usingMemory) return memory.get(name) ?? [];

  try {
    const raw = await fs.readFile(FILES[name], "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code === "ENOENT") return [];
    // Corrupt or unreadable — fall back to memory rather than crash.
    console.error(`[blackbox] cannot read ${name}:`, err.message);
    usingMemory = true;
    return memory.get(name) ?? [];
  }
}

async function writeCollection(name, rows) {
  const capped = applyLimit(name, rows);
  memory.set(name, capped);

  if (usingMemory) return capped;

  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(FILES[name], JSON.stringify(capped, null, 2), "utf8");
  } catch (err) {
    if (!usingMemory) {
      console.error(
        `[blackbox] filesystem not writable (${err.message}); using in-memory storage`
      );
    }
    usingMemory = true;
  }

  return capped;
}

function applyLimit(name, rows) {
  const limit = LIMITS[name];
  if (!limit || rows.length <= limit) return rows;
  // Events are append-ordered; incidents are newest-first.
  return name === "events" ? rows.slice(rows.length - limit) : rows.slice(0, limit);
}

function mutate(name, fn) {
  return withLock(name, async () => {
    const rows = await readCollection(name);
    const result = fn(rows);
    await writeCollection(name, result.rows);
    return result.value;
  });
}

/* ------------------------------------------------------------------ *
 * Sites
 * ------------------------------------------------------------------ */

export async function getSites() {
  const rows = await readCollection("sites");
  return [...rows].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

export async function getSiteById(id) {
  const rows = await readCollection("sites");
  return rows.find((s) => s.id === id) ?? null;
}

export async function createSite(site) {
  return mutate("sites", (rows) => {
    rows.push(site);
    return { rows, value: site };
  });
}

export async function updateSite(id, data) {
  return mutate("sites", (rows) => {
    const i = rows.findIndex((s) => s.id === id);
    if (i === -1) return { rows, value: null };
    rows[i] = { ...rows[i], ...data, id };
    return { rows, value: rows[i] };
  });
}

export async function deleteSite(id) {
  return mutate("sites", (rows) => {
    const next = rows.filter((s) => s.id !== id);
    return { rows: next, value: next.length !== rows.length };
  });
}

/* ------------------------------------------------------------------ *
 * Events
 * ------------------------------------------------------------------ */

export async function getEvents(limit = 200) {
  const rows = await readCollection("events");
  return rows.slice(-limit).reverse();
}

export async function getEventsBySite(siteId, limit = 200) {
  const rows = await readCollection("events");
  return rows
    .filter((e) => e.siteId === siteId)
    .slice(-limit)
    .reverse();
}

export async function saveEvent(event) {
  const [saved] = await saveEvents([event]);
  return saved ?? null;
}

/**
 * Append events, skipping any whose eventId has already been seen for the
 * site. Returns the events that were actually stored.
 */
export async function saveEvents(events) {
  return mutate("events", (rows) => {
    const seen = new Set(
      rows.map((e) => (e.eventId ? `${e.siteId}:${e.eventId}` : null)).filter(Boolean)
    );

    const stored = [];
    for (const event of events) {
      const key = event.eventId ? `${event.siteId}:${event.eventId}` : null;
      if (key && seen.has(key)) continue; // duplicate delivery — ignore
      if (key) seen.add(key);
      rows.push(event);
      stored.push(event);
    }

    return { rows, value: stored };
  });
}

export async function hasEventId(siteId, eventId) {
  if (!eventId) return false;
  const rows = await readCollection("events");
  return rows.some((e) => e.siteId === siteId && e.eventId === eventId);
}

/* ------------------------------------------------------------------ *
 * Incidents
 * ------------------------------------------------------------------ */

export async function getIncidents(limit = 200) {
  const rows = await readCollection("incidents");
  return [...rows]
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
    .slice(0, limit);
}

export async function getIncidentsBySite(siteId, limit = 200) {
  const rows = await readCollection("incidents");
  return rows
    .filter((i) => i.siteId === siteId)
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
    .slice(0, limit);
}

export async function getIncidentById(id) {
  const rows = await readCollection("incidents");
  return rows.find((i) => i.id === id) ?? null;
}

export async function saveIncident(incident) {
  return mutate("incidents", (rows) => {
    const i = rows.findIndex((r) => r.id === incident.id);
    if (i === -1) rows.push(incident);
    else rows[i] = incident;
    return { rows, value: incident };
  });
}

export async function updateIncident(id, data) {
  return mutate("incidents", (rows) => {
    const i = rows.findIndex((r) => r.id === id);
    if (i === -1) return { rows, value: null };
    rows[i] = { ...rows[i], ...data, id };
    return { rows, value: rows[i] };
  });
}

export async function deleteIncidentsBySite(siteId) {
  return mutate("incidents", (rows) => {
    const next = rows.filter((i) => i.siteId !== siteId);
    return { rows: next, value: rows.length - next.length };
  });
}

export async function deleteEventsBySite(siteId) {
  return mutate("events", (rows) => {
    const next = rows.filter((e) => e.siteId !== siteId);
    return { rows: next, value: rows.length - next.length };
  });
}

/* ------------------------------------------------------------------ *
 * Connections (pairing codes + collector credentials)
 * ------------------------------------------------------------------ */

export async function getConnections() {
  return readCollection("connections");
}

export async function getConnection(siteId) {
  const rows = await readCollection("connections");
  return rows.find((c) => c.siteId === siteId) ?? null;
}

export async function getConnectionByCode(code) {
  const rows = await readCollection("connections");
  return rows.find((c) => c.code === code) ?? null;
}

/**
 * Write connection data as a PATCH, never as a whole-row replace.
 *
 * Callers used to spread a previously-read row back in, which silently
 * reverted fields another call had just written — a used pairing code could be
 * replayed because `codeUsed` was overwritten with a stale `false`. Merging
 * only the keys a caller actually names makes that impossible.
 */
export async function saveConnection(siteId, patch) {
  return mutate("connections", (rows) => {
    const i = rows.findIndex((c) => c.siteId === siteId);

    if (i === -1) {
      const created = { siteId, ...patch };
      rows.push(created);
      return { rows, value: created };
    }

    rows[i] = { ...rows[i], ...patch, siteId };
    return { rows, value: rows[i] };
  });
}

/** Explicit field-level patch. */
export async function updateConnection(siteId, patch) {
  return mutate("connections", (rows) => {
    const i = rows.findIndex((c) => c.siteId === siteId);
    if (i === -1) return { rows, value: null };
    rows[i] = { ...rows[i], ...patch, siteId };
    return { rows, value: rows[i] };
  });
}

export async function deleteConnection(siteId) {
  return mutate("connections", (rows) => {
    const next = rows.filter((c) => c.siteId !== siteId);
    return { rows: next, value: next.length !== rows.length };
  });
}
