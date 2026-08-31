/**
 * Read helpers shared by the dashboard pages.
 */

import { getSites, getIncidents, getIncidentsBySite, getEvents, getFiles } from "./storage";
import { connectionHealth, timeAgo } from "./sites";
import { describeEvent } from "./schemas";
import { attentionFiles } from "./files/model";

/** Severity ordering for sorting by urgency. */
const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

const OPEN = (i) => !["resolved", "false_positive"].includes(i.status);

/** Routine findings belong in the activity feed, not the incident queue. */
const isRoutine = (i) => i.severity === "info";

/**
 * Per-site rollup used by the website cards.
 *
 * `incidents` must be supplied when called from a render — the fallback fetch
 * is for API/tooling use, and reading the clock during render is impure.
 */
export async function getSiteStats(siteId, incidents) {
  const list = incidents ?? (await getIncidentsBySite(siteId, 100));
  const open = list.filter(OPEN);

  return {
    risk: open.length ? Math.max(...open.map((i) => i.riskScore ?? 0)) : 0,
    open: open.length,
    critical: open.filter((i) => i.severity === "critical").length,
    high: open.filter((i) => i.severity === "high").length,
    total: list.length,
  };
}

/** Derive a website's own health from its open incidents. */
function websiteHealth(openIncidents) {
  if (openIncidents.some((i) => i.severity === "critical")) return "critical";
  if (openIncidents.some((i) => !isRoutine(i))) return "attention";
  return "healthy";
}

/** "Good morning / afternoon / evening". */
function greeting(now) {
  const hour = new Date(now).getHours();
  if (hour < 5) return "Working late";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * The priority queue shown under "Needs attention": security findings and
 * collector problems in one list, ordered by urgency.
 */
function buildNeedsAttention({ sites, incidents, files, now }) {
  const siteById = new Map(sites.map((s) => [s.site.id, s]));
  const items = [];

  for (const incident of incidents) {
    if (!OPEN(incident) || isRoutine(incident)) continue;
    if (!["critical", "high", "medium"].includes(incident.severity)) continue;

    const site = siteById.get(incident.siteId);
    items.push({
      id: incident.id,
      kind: "incident",
      severity: incident.severity,
      siteId: incident.siteId,
      siteName: site?.site.name ?? "Unknown site",
      reason: incident.severity === "critical" ? "Possible website compromise" : incident.title,
      detail: incident.summary,
      cta: "Investigate",
      href: `/incidents/${incident.id}`,
      at: incident.startedAt,
    });
  }

  for (const { site, collector } of sites) {
    if (collector.key === "connected") continue;
    const label =
      collector.key === "issue"
        ? `Collector hasn't reported for ${timeAgo(collector.since, now)}`
        : collector.key === "disconnected"
          ? "Collector disconnected"
          : "Collector never connected";

    items.push({
      id: `conn:${site.id}`,
      kind: "connection",
      severity: collector.key === "disconnected" ? "high" : "medium",
      siteId: site.id,
      siteName: site.name,
      reason: label,
      detail: "Events stop arriving while the collector can't reach ScanSite.",
      cta: "Fix connection",
      href: `/websites/${site.id}`,
      at: collector.since ?? now,
    });
  }

  // Suspicious files are operational priorities too.
  for (const file of attentionFiles(files)) {
    const site = siteById.get(file.siteId);
    items.push({
      id: file.id,
      kind: "file",
      severity: file.integrityStatus === "critical" ? "critical" : "high",
      siteId: file.siteId,
      siteName: site?.site.name ?? "Unknown site",
      reason: `${file.filename} — ${(file.signals ?? [])[0] ?? "suspicious file"}`,
      detail: `/${file.relativePath}`,
      cta: "Inspect",
      href: `/websites/${file.siteId}/files/${file.id}`,
      at: file.modifiedAt ?? now,
    });
  }

  return items.sort((a, b) => {
    const r = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    return r !== 0 ? r : (b.at ?? 0) - (a.at ?? 0);
  });
}

/** A short, friendly line for the recent-activity feed. */
/**
 * Benign activity. These belong in Recent Activity as successes — never mixed
 * into the incidents that need attention.
 */
const BENIGN_TYPES = new Set([
  "plugin_updated",
  "theme_updated",
  "wordpress_updated",
  "plugin_installed",
  "theme_installed",
  "login_success",
  "logout",
  "collector_test",
  "file_integrity_scan_completed",
]);

/** Success-flavoured wording for routine events, plain description otherwise. */
function activityText(e) {
  const name = e.target?.name ?? e.target?.plugin ?? e.target?.theme ?? e.target?.username;
  const ver = e.changes?.from && e.changes?.to ? ` (${e.changes.from} → ${e.changes.to})` : "";

  switch (e.type) {
    case "plugin_updated":
      return `Plugin "${name}" updated successfully${ver}`;
    case "theme_updated":
      return `Theme "${name}" updated successfully${ver}`;
    case "wordpress_updated":
      return `WordPress core updated successfully${ver}`;
    case "file_integrity_scan_completed":
      return `File integrity scan completed (${e.metadata?.filesChecked ?? 0} files checked, ${e.metadata?.critical ?? 0} critical)`;
    case "collector_test":
      return "Collector self-test received";
    default:
      return describeEvent(e);
  }
}

/**
 * One unified Recent Activity feed: benign events, routine incidents and
 * collector heartbeats, newest first. Routine maintenance lives here rather
 * than beside the criticals.
 */
function buildActivity(events, now, { sites = [], routineIncidents = [] } = {}) {
  const entries = [];

  for (const e of events.slice(0, 40)) {
    const routine = BENIGN_TYPES.has(e.type);
    entries.push({
      at: e.timestamp,
      text: activityText(e),
      time: timeAgo(e.timestamp, now),
      tone: routine ? "ok" : "dot",
      kind: routine ? "routine" : "event",
    });
  }

  // Heartbeats are not events; they are the collector proving it is alive.
  for (const s of sites) {
    if (!s.site?.lastSeenAt) continue;
    entries.push({
      at: s.site.lastSeenAt,
      text: `Collector heartbeat received — ${s.site.name}`,
      time: timeAgo(s.site.lastSeenAt, now),
      tone: "ok",
      kind: "routine",
    });
  }

  const siteName = (id) => sites.find((s) => s.site.id === id)?.site.name ?? id;
  for (const i of routineIncidents.slice(0, 10)) {
    entries.push({
      at: i.startedAt ?? i.endedAt ?? now,
      text: `${i.title} — ${siteName(i.siteId)}`,
      time: timeAgo(i.startedAt ?? now, now),
      tone: "ok",
      kind: "routine",
    });
  }

  return entries.sort((a, b) => b.at - a.at).slice(0, 10);
}

/** Overview model for the redesigned dashboard. */
export async function getOverview() {
  const [sitesRaw, incidents, events, files] = await Promise.all([
    getSites(),
    getIncidents(500),
    getEvents(5000),
    getFiles(),
  ]);
  const now = Date.now();

  const bySite = new Map();
  for (const i of incidents) {
    if (!bySite.has(i.siteId)) bySite.set(i.siteId, []);
    bySite.get(i.siteId).push(i);
  }

  const filesBySite = new Map();
  for (const f of files) {
    if (!filesBySite.has(f.siteId)) filesBySite.set(f.siteId, []);
    filesBySite.get(f.siteId).push(f);
  }

  const sites = sitesRaw.map((site) => {
    const mine = bySite.get(site.id) ?? [];
    const open = mine.filter(OPEN);
    const collector = connectionHealth(site, now);
    const health = websiteHealth(open);
    const myFiles = filesBySite.get(site.id) ?? [];

    return {
      site,
      collector,
      stats: getSiteStatsFromOpen(open, mine),
      websiteHealth: health,
      openIncidents: open,
      fileStats: {
        checked: myFiles.length,
        critical: myFiles.filter((f) => f.integrityStatus === "critical").length,
        suspicious: myFiles.filter((f) => f.integrityStatus === "suspicious").length,
      },
      inventory: site.inventory ?? null,
    };
  });

  const incidentsSorted = [...incidents].sort((a, b) => {
    const ar = SEVERITY_RANK[a.severity] ?? 4;
    const br = SEVERITY_RANK[b.severity] ?? 4;
    if (ar !== br) return ar - br;
    return (b.startedAt ?? 0) - (a.startedAt ?? 0);
  });

  const priorityIncidents = incidentsSorted.filter((i) => OPEN(i) && !isRoutine(i));
  const routineIncidents = incidents.filter((i) => isRoutine(i));

  const needsAttention = buildNeedsAttention({ sites, incidents, files, now });
  const collectorIssues = sites.filter((s) => s.collector.key !== "connected").length;
  const openIncidents = incidents.filter(OPEN).length;

  const top = priorityIncidents[0] ?? null;
  const topSite = top ? sites.find((s) => s.site.id === top.siteId) : null;

  return {
    now,
    greeting: greeting(now),
    subtitle: `${sites.length} website${sites.length === 1 ? "" : "s"} · ${
      sites.filter((s) => s.collector.key === "connected").length
    } connected · ${openIncidents} open incident${openIncidents === 1 ? "" : "s"}`,
    sites,
    incidents: incidentsSorted,
    priorityIncidents,
    routineIncidents,
    needsAttention,
    counts: {
      sitesMonitored: sites.length,
      connected: sites.filter((s) => s.collector.key === "connected").length,
      needAttention: new Set(needsAttention.map((n) => n.siteId)).size,
      openIncidents,
      collectorIssues,
      critical: priorityIncidents.filter((i) => i.severity === "critical").length,
      suspiciousFiles: attentionFiles(files).length,
    },
    recentActivity: buildActivity(events, now, { sites, routineIncidents }),
    top,
    topSite: topSite?.site ?? null,
  };
}

function getSiteStatsFromOpen(open, all) {
  return {
    risk: open.length ? Math.max(...open.map((i) => i.riskScore ?? 0)) : 0,
    open: open.length,
    critical: open.filter((i) => i.severity === "critical").length,
    high: open.filter((i) => i.severity === "high").length,
    total: all.length,
  };
}

/**
 * ScanSite base URL for the connection instructions.
 *
 * Never hardcoded to a production domain — an explicit env var wins. Otherwise
 * we prefer the public address reported by a reverse proxy or tunnel
 * (X-Forwarded-Host / X-Forwarded-Proto), falling back to the Host the request
 * arrived on, so a LAN address, a cloudflared tunnel, or the hosted preview all
 * work without code changes. Only used to *display* a suggested endpoint; it is
 * never part of authentication.
 */
export function scansiteBaseUrl(req) {
  const configured = process.env.NEXT_PUBLIC_SCANSITE_BASE_URL;
  if (configured) return configured.replace(/\/$/, "");

  const fwdHost = firstValue(req?.fwdHost);
  const host = fwdHost ?? req?.host;
  if (host) {
    // Behind a proxy the public scheme is what the proxy saw; a forwarded
    // host without a proto implies TLS termination at the proxy.
    const proto = firstValue(req?.proto) ?? (fwdHost ? "https" : "http");
    return `${proto}://${host}`;
  }

  if (req?.url) {
    try {
      return new URL(req.url).origin;
    } catch {
      // fall through
    }
  }

  return "";
}

/** First entry of a possibly comma-separated forwarded header value. */
function firstValue(value) {
  if (!value) return null;
  const first = value.split(",")[0].trim();
  return first || null;
}
