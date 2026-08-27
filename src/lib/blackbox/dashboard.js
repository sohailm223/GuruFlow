/**
 * Read helpers shared by the dashboard pages.
 */

import { getSites, getIncidents, getIncidentsBySite } from "./storage";
import { connectionHealth } from "./sites";

/**
 * Per-site rollup used by the website cards.
 *
 * `incidents` must be supplied when called from a render — the fallback fetch
 * is for API/tooling use, and reading the clock during render is impure.
 */
export async function getSiteStats(siteId, incidents) {
  const list = incidents ?? (await getIncidentsBySite(siteId, 100));
  const open = list.filter((i) => !["resolved", "false_positive"].includes(i.status));

  return {
    risk: open.length ? Math.max(...open.map((i) => i.riskScore ?? 0)) : 0,
    open: open.length,
    critical: open.filter((i) => i.severity === "critical").length,
    high: open.filter((i) => i.severity === "high").length,
    total: list.length,
  };
}

/** Overview counters. */
export async function getOverview() {
  const [sites, incidents] = await Promise.all([getSites(), getIncidents(500)]);
  const now = Date.now();

  const withHealth = sites.map((site) => ({
    site,
    health: connectionHealth(site, now),
  }));

  const criticalSites = new Set(
    incidents
      .filter((i) => i.severity === "critical" && !["resolved", "false_positive"].includes(i.status))
      .map((i) => i.siteId)
  );

  return {
    sites: withHealth,
    incidents,
    counts: {
      connected: sites.length,
      healthy: withHealth.filter((s) => s.health.key === "connected").length,
      needsAttention: withHealth.filter((s) => s.health.key === "issue").length,
      critical: criticalSites.size,
    },
  };
}

/**
 * ScanSite base URL for the connection instructions.
 *
 * Never hardcoded to a production domain — an explicit env var wins, otherwise
 * it is derived from the request the user actually made, so a LAN address or a
 * development tunnel works without code changes.
 */
export function scansiteBaseUrl(req) {
  const configured = process.env.NEXT_PUBLIC_SCANSITE_BASE_URL;
  if (configured) return configured.replace(/\/$/, "");

  if (req?.url) {
    try {
      const url = new URL(req.url);
      return url.origin;
    } catch {
      // fall through
    }
  }

  return "";
}
