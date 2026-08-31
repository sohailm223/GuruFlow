/**
 * Ingest pipeline — the full flow a collector request goes through.
 *
 *   authenticate site → validate payload → normalise → deduplicate → store
 *   → find related incident → group → run detectors → score → confidence
 *   → evidence → causal chain → impact → recommendations → save
 */

import { normalizeBatch, normalizeEvent } from "./schemas";
import { groupIntoIncidents, findOpenIncident } from "./grouping";
import { analyzeIncident } from "./analyzer";
import {
  saveEvents,
  getEventsBySite,
  getIncidentsBySite,
  saveIncident,
  getIncidentById,
  updateSite,
} from "./storage";
import { recordFileEvidence } from "./files/model";

/**
 * Handle an already-authenticated batch of collector events.
 *
 * @param {string} siteId
 * @param {object} payload  { events: [...] }
 */
export async function ingestEvents(siteId, payload) {
  const batch = normalizeBatch(payload, { siteId });
  if (!batch.ok) {
    return { ok: false, status: 400, error: batch.error, rejected: batch.rejected };
  }

  // Deduplicate against everything already stored for this site.
  const stored = await saveEvents(batch.events);
  const duplicates = batch.events.length - stored.length;

  await updateSite(siteId, {
    lastEventAt: stored.length ? stored[stored.length - 1].timestamp : undefined,
    lastSeenAt: Date.now(),
  });

  // Persist normalised file records + inventory derived from these events.
  await recordFileEvidence(siteId, stored);

  if (!stored.length) {
    return { ok: true, accepted: 0, duplicates, rejected: batch.rejected, incidents: [] };
  }

  // Re-analyse from the full stored history so an incident that is still
  // unfolding is extended rather than forked into fragments.
  const recent = await getEventsBySite(siteId, 500);
  const windowStart = stored[0].timestamp - 6 * 3_600_000;
  const relevant = recent
    .filter((e) => e.timestamp >= windowStart)
    .sort((a, b) => a.timestamp - b.timestamp);

  const existing = await getIncidentsBySite(siteId, 50);
  const groups = groupIntoIncidents(relevant);

  // Identity is eventId (falling back to type+timestamp for events the
  // collector sent without one) — never object reference, because events are
  // re-read from storage as fresh objects on every call.
  const keyOf = (e) => e.eventId ?? `${e.type}:${e.timestamp}`;
  const newKeys = new Set(stored.map(keyOf));

  const results = [];
  const touchedIds = new Set();

  for (const group of groups) {
    // Only persist groups that contain something new, or that extend an
    // incident we already have.
    const overlap = group.some((e) => newKeys.has(keyOf(e)));
    if (!overlap) continue;

    const prior = existing.find((i) =>
      group.some((e) => i.events?.some((pe) => pe.eventId && pe.eventId === e.eventId))
    );

    const incident = analyzeIncident(group, {
      siteId,
      id: prior?.id,
      status: prior?.status,
      createdAt: prior?.createdAt,
      knownIps: knownIpsBefore(recent, group[0].timestamp),
    });

    const saved = carryOperatorFields(prior, incident);
    await saveIncident(saved);
    results.push(saved);
    touchedIds.add(incident.id);
  }

  return {
    ok: true,
    accepted: stored.length,
    duplicates,
    // Report per-event rejections even on a partially successful batch, so a
    // collector that sent one malformed event alongside good ones can see it
    // instead of silently believing everything landed.
    rejected: batch.rejected,
    incidents: results.map(publicIncidentSummary),
    incidentIds: [...touchedIds],
  };
}

/**
 * Handle a collector self-test. Stored like any other event so the dashboard
 * can prove delivery actually happened, but excluded from incident analysis.
 */
export async function ingestTestEvent(siteId, rawEvent) {
  const normalized = normalizeEvent(
    { ...rawEvent, type: rawEvent?.type === "collector_test" ? "collector_test" : "collector_test" },
    { siteId }
  );

  if (!normalized.ok) {
    return { ok: false, status: 400, error: normalized.error };
  }

  const [saved] = await saveEvents([normalized.event]);

  await updateSite(siteId, { lastSeenAt: Date.now() });

  return {
    ok: true,
    received: Boolean(saved),
    duplicate: !saved,
    eventId: normalized.event.eventId,
    receivedAt: Date.now(),
  };
}

/** Compact shape returned to collectors — never the full analysis. */
export function publicIncidentSummary(incident) {
  return {
    id: incident.id,
    siteId: incident.siteId,
    startedAt: incident.startedAt,
    endedAt: incident.endedAt,
    durationMinutes: incident.durationMinutes,
    eventCount: incident.eventCount,
    severity: incident.severity,
    severityLabel: incident.severityLabel,
    riskScore: incident.riskScore,
    confidence: incident.confidence,
    title: incident.title,
    summary: incident.summary,
    status: incident.status,
  };
}

/**
 * Fields a person adds to an incident through the dashboard. Analysis is
 * re-run every time new events extend an incident, and it must not erase what
 * an operator recorded — investigation notes, a false-positive reason or the
 * last verification run. Anything the analyzer itself produces is regenerated.
 */
const OPERATOR_FIELDS = ["notes", "statusNote", "falsePositiveReason", "statusUpdatedAt", "verification"];

function carryOperatorFields(prior, incident) {
  if (!prior) return incident;
  const merged = { ...incident };
  for (const k of OPERATOR_FIELDS) if (prior[k] !== undefined) merged[k] = prior[k];
  return merged;
}

/**
 * IPs seen before a given moment. Lets the entry-point classifier say "this IP
 * does not appear in earlier activity" only when that is actually checkable.
 */
function knownIpsBefore(events, timestamp) {
  const ips = new Set();
  for (const e of events) {
    if (e.timestamp < timestamp && e.actor?.ip) ips.add(e.actor.ip);
  }
  return ips;
}

/** Re-analyse stored events without accepting new ones (used by /analyze). */
export async function analyzeStored(siteId) {
  const events = await getEventsBySite(siteId, 500);
  const incidents = [];
  for (const group of groupIntoIncidents(events)) {
    const incident = analyzeIncident(group, { siteId, knownIps: knownIpsBefore(events, group[0].timestamp) });
    incidents.push(incident);
  }
  return incidents;
}

export { getIncidentById, updateSite };
