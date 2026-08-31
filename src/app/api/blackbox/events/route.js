import { json } from "../_lib";
import { getEvents, getEventsBySite, getIncidentsBySite } from "@/lib/blackbox/storage";
import { scoreEvent } from "@/lib/blackbox/scoring";
import { severityFromScore } from "@/lib/blackbox/confidence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/blackbox/events
 *
 * Raw event feed, newest first.
 *
 *   ?site=            restrict to one website
 *   ?limit=&offset=   pagination (limit capped at 500)
 *   ?category=&type=& actor / search / from / to / incident filters
 *   ?correlation=1    include same-actor / same-IP / same-plugin counts
 *
 * Powers "Recent Activity" on a website and the Raw Event Explorer.
 */
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const site = searchParams.get("site");
  const limit = Math.min(500, Math.max(1, Number(searchParams.get("limit") ?? 100) || 100));
  const offset = Math.max(0, Number(searchParams.get("offset") ?? 0) || 0);

  // Pull a working set, filter it, then page. Filtering after a capped read is
  // deliberate: local storage is bounded anyway, and this keeps the query cheap.
  const working = site ? await getEventsBySite(site, 5000) : await getEvents(5000);

  const category = searchParams.get("category");
  const type = searchParams.get("type");
  const actor = (searchParams.get("actor") || "").toLowerCase();
  const q = (searchParams.get("q") || "").toLowerCase();
  const from = Number(searchParams.get("from") ?? 0) || 0;
  const to = Number(searchParams.get("to") ?? 0) || 0;
  const incidentId = searchParams.get("incident");
  // Risk band of the single event, from the same scoring engine the analyzer
  // uses — not a re-derivation.
  const risk = (searchParams.get("risk") || "").toLowerCase();

  // Incident membership comes from the stored incidents, which is what the
  // correlation engine actually decided — not a re-derivation here.
  const incidents = site ? await getIncidentsBySite(site) : [];
  const eventToIncident = new Map();
  for (const inc of incidents) {
    for (const ref of inc.events ?? []) {
      if (ref?.eventId) eventToIncident.set(ref.eventId, inc);
    }
  }

  const filtered = working.filter((e) => {
    if (category && e.category !== category) return false;
    if (type && e.type !== type) return false;
    if (from && e.timestamp < from) return false;
    if (to && e.timestamp > to) return false;
    if (incidentId) {
      const inc = eventToIncident.get(e.eventId);
      if (!inc || inc.id !== incidentId) return false;
    }
    if (actor) {
      const name = (e.actor?.username || "").toLowerCase();
      if (!name.includes(actor)) return false;
    }
    if (risk && riskBand(e) !== risk) return false;
    if (q) {
      if (!matchesQuery(e, q)) return false;
    }
    return true;
  });

  const total = filtered.length;
  const page = filtered.slice(offset, offset + limit);

  const withCorrelation = searchParams.get("correlation") === "1";
  const decorate = (e) => ({
    ...e,
    riskScore: scoreEvent(e).score,
    riskBand: riskBand(e),
    incident: incidentSummary(eventToIncident.get(e.eventId)),
  });
  const events = withCorrelation
    ? page.map((e) => ({ ...decorate(e), correlation: correlationFor(e, working, eventToIncident) }))
    : page.map(decorate);

  return json({
    events,
    total,
    offset,
    limit,
    // Header stats for the Explorer. Computed here rather than in the client so
    // "today" is stable and no timestamp is derived during a render pass.
    stats: {
      eventsToday: working.filter((e) => e.timestamp >= startOfToday()).length,
      lastEventAt: working.length ? working[0].timestamp : null,
      totalAllTime: working.length,
    },
    facets: {
      categories: facets(working, (e) => e.category),
      types: facets(working, (e) => e.type),
      actors: facets(working, (e) => e.actor?.username),
    },
  });
}

/** Single-event risk band, matching the incident severity scale. */
function riskBand(e) {
  return severityFromScore(scoreEvent(e).score).severity;
}

function matchesQuery(e, q) {
  const hay = [
    e.type,
    e.category,
    e.eventId,
    e.actor?.username,
    e.actor?.ip,
    e.target?.username,
    e.target?.name,
    e.target?.plugin,
    e.target?.theme,
    e.target?.hook,
    e.path,
    e.changes?.from,
    e.changes?.to,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

/** How many other events share each correlation dimension with this one. */
function correlationFor(event, all, eventToIncident) {
  const sameActor =
    event.actor?.username != null
      ? all.filter((e) => e.eventId !== event.eventId && e.actor?.username === event.actor.username).length
      : 0;
  const sameIp =
    event.actor?.ip != null
      ? all.filter((e) => e.eventId !== event.eventId && e.actor?.ip === event.actor.ip).length
      : 0;
  const samePlugin =
    event.target?.plugin != null
      ? all.filter((e) => e.eventId !== event.eventId && e.target?.plugin === event.target.plugin).length
      : 0;
  const incident = eventToIncident.get(event.eventId);
  const sameIncident = incident ? Math.max(0, (incident.events ?? []).length - 1) : 0;

  return { sameActor, sameIp, samePlugin, sameIncident };
}

function incidentSummary(inc) {
  if (!inc) return null;
  return {
    id: inc.id,
    title: inc.title,
    severity: inc.severity,
    riskScore: inc.riskScore,
    status: inc.status,
  };
}

/** Midnight local time, used for the "Events Today" header stat. */
function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function facets(events, pick) {  const counts = new Map();
  for (const e of events) {
    const key = pick(e);
    if (key == null || key === "") continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 40);
}
