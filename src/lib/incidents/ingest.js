/**
 * Black Box ingest pipeline: raw collector payload → analysed incident records.
 */

import { normalizeBatch } from "./eventSchema";
import { groupIntoIncidents } from "./correlate";
import { describeEvent } from "./narrative";
import {
  newIncidentId,
  saveIncidents,
  upsertSite,
  bumpSiteIncidentCount,
} from "./store";

/**
 * @param {object} payload  { site, events: [...] }
 * @param {object} [options] { gapMinutes, maxWindowHours, persist = true }
 * @returns {Promise<{ok:boolean, error?:string, rejected?:Array, site?:object, incidents:Array}>}
 */
export async function ingestEvents(payload, options = {}) {
  const { persist = true, ...groupOpts } = options;

  const batch = normalizeBatch(payload);
  if (!batch.ok) {
    return { ok: false, error: batch.error, rejected: batch.rejected };
  }

  const analyzed = groupIntoIncidents(batch.events, groupOpts);

  const records = analyzed.map((a) => buildRecord(a, batch.site));

  if (persist) {
    await upsertSite({
      site: batch.site,
      receivedAt: batch.receivedAt,
      eventCount: batch.events.length,
    });
    await saveIncidents(records);
    for (let i = 0; i < records.length; i++) {
      await bumpSiteIncidentCount(batch.site);
    }
  }

  return {
    ok: true,
    site: batch.site,
    accepted: batch.events.length,
    rejected: batch.rejected,
    incidents: records,
  };
}

/** Flatten an analysed incident into a storable/serialisable record. */
export function buildRecord(analysis, site, id = newIncidentId()) {
  const top = analysis.findings[0];

  return {
    id,
    site,
    startedAt: analysis.startedAt,
    endedAt: analysis.endedAt,
    durationMinutes: analysis.durationMinutes,
    eventCount: analysis.eventCount,
    categories: analysis.categories,
    risk: analysis.risk,
    score: analysis.score,
    headline: analysis.headline,
    likelyCause: analysis.likelyCause,
    findings: analysis.findings.map((f) => ({
      id: f.id,
      headline: f.headline,
      cause: f.cause,
      weight: f.weight,
    })),
    suspectEventIds: analysis.suspectEvents.map((e) => e.id).filter(Boolean),
    timeline: analysis.events.map((e) => ({
      at: e.at,
      category: e.category,
      type: e.type,
      text: describeEvent(e),
      path: e.path,
      target: e.target,
      actor: e.actor,
      from: e.from,
      to: e.to,
      count: e.count,
      sourceIp: e.sourceIp,
      meta: e.meta,
    })),
    analyzedAt: Date.now(),
  };
}

/** Analyse without storing — powers the /analyze dry-run endpoint. */
export function analyzeOnly(payload, options = {}) {
  const batch = normalizeBatch(payload);
  if (!batch.ok) return { ok: false, error: batch.error, rejected: batch.rejected };

  const analyzed = groupIntoIncidents(batch.events, options);
  return {
    ok: true,
    site: batch.site,
    accepted: batch.events.length,
    rejected: batch.rejected,
    incidents: analyzed.map((a) => buildRecord(a, batch.site, null)),
  };
}
