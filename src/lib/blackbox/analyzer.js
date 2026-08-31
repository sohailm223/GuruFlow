/**
 * Incident analyser — assembles the incident model the UI renders.
 *
 * Pipeline (unchanged in spirit from the original Black Box):
 *
 *   events → grouping → event scoring → detectors → likely cause
 *
 * and then extended with correlation, confidence, separated concepts
 * (cause / change / persistence / impact), evidence and recommendations.
 *
 * Pure functions only — no storage, no network — so the engine can be reused
 * from ingest, from the dry-run analyser and from tests.
 */

import crypto from "crypto";
import { scoreEvent } from "./scoring";
import { runDetectors } from "./detectors";
import {
  clusterEvents,
  extractActors,
  affectedAreas,
  extractIps,
  buildAttackChain,
} from "./correlation";
import {
  clamp,
  confidenceFor,
  confidenceLabel,
  riskScoreFromRaw,
  severityFromScore,
} from "./confidence";
import { recommendationsFor } from "./recommendations";
import { describeEvent } from "./schemas";
import { groupIntoIncidents } from "./grouping";
import { classifyEntryPoint } from "./entrypoint";
import { buildRemediationPlan, buildPrevention } from "./remediation";

export function newIncidentId() {
  return `inc_${crypto.randomBytes(6).toString("hex")}`;
}

/**
 * Analyse one group of events into a full incident record.
 *
 * @param {Array}  events  normalised events for a single incident window
 * @param {object} opts    { siteId, id, status, createdAt }
 */
export function analyzeIncident(events, opts = {}) {
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);

  const scored = sorted.map(scoreEvent);
  const rawScore = scored.reduce((sum, s) => sum + s.score, 0);

  const findings = runDetectors(sorted);
  const patternWeight = findings.reduce((sum, f) => sum + f.weight, 0);

  // Event evidence sets the headline risk; how strongly a known attack
  // pattern matched scales it up, capped at 100.
  // Event evidence sets the headline risk; a recognised attack pattern lifts it
  // a little, never enough to jump a band on its own.
  const riskScore = clamp(
    Math.round(riskScoreFromRaw(rawScore) * (1 + Math.min(patternWeight, 60) / 400))
  );
  const { severity, label: severityLabel } = severityFromScore(riskScore);

  const top = findings[0];
  const concepts = mergeConcepts(findings);
  const chain = buildAttackChain(sorted, scored);
  const actors = extractActors(sorted);
  const clusters = clusterEvents(sorted).filter((c) => c.keys.length);

  const durationMinutes = sorted.length
    ? Math.round((sorted[sorted.length - 1].timestamp - sorted[0].timestamp) / 60_000)
    : 0;

  const eventRefs = sorted.map((e) => ({
    eventId: e.eventId,
    timestamp: e.timestamp,
    category: e.category,
    type: e.type,
    text: describeEvent(e),
    path: e.path ?? e.target?.path,
    target: e.target,
    changes: e.changes,
    count: e.count,
    actor: e.actor,
    severityHint: e.severityHint,
    metadata: e.metadata,
    score: scoreEvent(e).score,
  }));

  // Likely infection path + remediation plan are derived from the same stored
  // events, so the guidance can never drift from the evidence shown.
  const entryPoint = classifyEntryPoint(eventRefs, { knownIps: opts.knownIps ?? null });
  const remediation = buildRemediationPlan({ events: eventRefs, entryPoint });
  const prevention = buildPrevention({ events: eventRefs, entryPoint });

  const confidence = confidenceFor({
    findings,
    evidenceCount: top?.evidence?.length ?? 0,
    eventCount: sorted.length,
    // Size of the largest identity-linked cluster (same actor/IP/session/target).
    correlation: Math.max(0, (clusters[0]?.events?.length ?? 1) - 1),
    durationMinutes,
  });

  return {
    id: opts.id ?? newIncidentId(),
    siteId: opts.siteId ?? sorted[0]?.siteId ?? null,
    createdAt: opts.createdAt ?? Date.now(),
    startedAt: sorted[0]?.timestamp ?? null,
    endedAt: sorted[sorted.length - 1]?.timestamp ?? null,
    durationMinutes: sorted.length
      ? Math.round((sorted[sorted.length - 1].timestamp - sorted[0].timestamp) / 60_000)
      : 0,
    status: opts.status ?? "new",

    rawScore,
    riskScore,
    severity,
    severityLabel,
    confidence,
    confidenceLabel: confidenceLabel(confidence),

    // Likely infection path, prioritised fix plan and prevention advice.
    entryPoint,
    remediation,
    prevention,

    title: top?.title ?? "Routine site activity",
    summary: top?.summary ?? "No suspicious pattern detected in this window.",
    cause: top?.cause ?? "Only expected activity was observed.",

    concepts,
    change: concepts.change ?? null,
    persistence: concepts.persistence ?? null,
    impact: concepts.impact ?? null,

    attackChain: chain,
    findings: findings.map((f) => ({
      id: f.id,
      weight: f.weight,
      title: f.title,
      cause: f.cause,
    })),
    evidence: top?.evidence ?? [],
    recommendations: recommendationsFor(top, severity),

    actors,
    affectedAreas: affectedAreas(sorted),
    ips: extractIps(sorted),
    correlationClusters: clusters.map((c) => ({
      keys: c.keys,
      eventCount: c.events.length,
    })),

    eventCount: sorted.length,
    categories: [...new Set(sorted.map((e) => e.category))].sort(),
    events: eventRefs,

    analyzedAt: Date.now(),
  };
}

/**
 * The first detector to name a concept wins, so the headline story stays
 * coherent instead of mixing explanations from weaker patterns.
 */
function mergeConcepts(findings) {
  const out = {};
  for (const f of findings) {
    for (const [key, value] of Object.entries(f.concepts ?? {})) {
      if (value && !out[key]) out[key] = value;
    }
  }
  return out;
}

/** Analyse a flat list of events into one or more incidents. */
export function analyzeEvents(events, opts = {}) {
  return groupIntoIncidents(events, opts).map((group) =>
    analyzeIncident(group, { ...opts, id: undefined, status: undefined })
  );
}
