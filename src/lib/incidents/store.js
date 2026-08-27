/**
 * Black Box storage.
 *
 * Deliberately a tiny JSON-file driver behind an async interface so it can be
 * swapped for Hygraph (like the rest of GuruFlow) without touching callers:
 * every function here is `async` and deals in plain objects.
 *
 * Swap later: implement the same 5 functions against fetchHygraph() and change
 * the import in the routes.
 */

import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

const DATA_DIR = path.join(process.cwd(), "data", "blackbox");
const SITES_FILE = path.join(DATA_DIR, "sites.json");
const INCIDENTS_FILE = path.join(DATA_DIR, "incidents.json");

async function readJson(file, fallback) {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2), "utf8");
}

/* ---------------- sites ---------------- */

export async function upsertSite({ site, receivedAt, eventCount }) {
  const sites = await readJson(SITES_FILE, {});
  const existing = sites[site];

  sites[site] = {
    id: site,
    firstSeenAt: existing?.firstSeenAt ?? receivedAt,
    lastSeenAt: receivedAt,
    eventCount: (existing?.eventCount ?? 0) + eventCount,
    incidentCount: existing?.incidentCount ?? 0,
  };

  await writeJson(SITES_FILE, sites);
  return sites[site];
}

export async function listSites() {
  const sites = await readJson(SITES_FILE, {});
  return Object.values(sites).sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}

export async function bumpSiteIncidentCount(site) {
  const sites = await readJson(SITES_FILE, {});
  if (!sites[site]) return;
  sites[site].incidentCount = (sites[site].incidentCount ?? 0) + 1;
  await writeJson(SITES_FILE, sites);
}

/* ---------------- incidents ---------------- */

export async function saveIncidents(records) {
  const all = await readJson(INCIDENTS_FILE, []);
  const byId = new Map(all.map((i) => [i.id, i]));

  for (const record of records) byId.set(record.id, record);

  const merged = [...byId.values()].sort((a, b) => b.startedAt - a.startedAt);
  await writeJson(INCIDENTS_FILE, merged);
  return records;
}

export async function listIncidents({ site, limit = 100 } = {}) {
  const all = await readJson(INCIDENTS_FILE, []);
  const filtered = site ? all.filter((i) => i.site === site) : all;
  return filtered.slice(0, limit);
}

export async function getIncident(id) {
  const all = await readJson(INCIDENTS_FILE, []);
  return all.find((i) => i.id === id) ?? null;
}

export async function latestIncidentFor(site) {
  const all = await readJson(INCIDENTS_FILE, []);
  return all.find((i) => i.site === site) ?? null;
}

export function newIncidentId() {
  return `inc_${crypto.randomBytes(6).toString("hex")}`;
}
