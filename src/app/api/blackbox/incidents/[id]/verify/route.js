import { json, fail } from "../../../_lib";
import { getIncidentById, updateIncident, getEventsBySite, getFilesBySite, getSiteById, recordAudit } from "@/lib/blackbox/storage";
import { evaluateVerification } from "@/lib/blackbox/remediation";
import { probeStatus, canonicalOrigin } from "@/lib/blackbox/netguard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/blackbox/incidents/:id/verify
 *
 * Re-checks what ScanSite can actually re-check after a fix:
 *   - account removal / role change   (collector events; snapshot = weaker)
 *   - suspicious file gone            (file_deleted event, or a clean scan)
 *   - cron hook removed               (cron_removed / cron_modified)
 *   - file integrity scan             (latest scan with zero critical files)
 *   - website availability            (HTTP status of the registered origin)
 *
 * ScanSite changes nothing on the WordPress site.
 *
 * SSRF: this endpoint accepts NO URL. The only address it can reach is the
 * site's own stored origin, reduced to scheme + host + port, and every request
 * goes through the guard in lib/blackbox/netguard — http/https only, loopback
 * and private ranges blocked unless SCANSITE_ALLOW_LOCAL_VERIFY=1, link-local
 * and CGNAT blocked always, DNS results checked at connect time, redirects
 * validated before following, short timeout, body never read.
 */
export async function POST(_req, { params }) {
  const { id } = await params;

  const incident = await getIncidentById(id);
  if (!incident) return fail(404, "Incident not found");

  const [events, files, site] = await Promise.all([
    getEventsBySite(incident.siteId, 500),
    getFilesBySite(incident.siteId),
    getSiteById(incident.siteId),
  ]);

  // evaluateVerification decides per check whether evidence came after the
  // event that raised the concern: a deletion recorded inside the incident
  // window still counts, because remediation events are grouped in with the
  // activity they clean up.
  const siteStatus = await checkSite(site?.url);
  const verification = evaluateVerification(incident, { events, files, siteStatus });

  // Remediation progress is tracked separately from the incident's own status:
  // an incident can be confirmed while its cleanup is still half done.
  const updated = await updateIncident(id, {
    verification,
    remediationStatus: verification.remediationStatus,
  });

  await recordAudit({
    action: "incident_verification",
    incidentId: id,
    siteId: incident.siteId,
    detail: `${verification.resolved}/${verification.total} checks resolved (${verification.verified} strong, ${verification.likely} weak)`,
  });

  return json({ incident: updated, verification });
}

/** GET /api/blackbox/incidents/:id/verify — the last verification result. */
export async function GET(_req, { params }) {
  const { id } = await params;
  const incident = await getIncidentById(id);
  if (!incident) return fail(404, "Incident not found");
  return json({ verification: incident.verification ?? null, remediationStatus: incident.remediationStatus ?? "not_started" });
}

/**
 * Fetch only the HTTP status of the site's registered canonical origin.
 * Returns a blocked marker (rendered as "not monitored") rather than a failure
 * when policy forbids the request, so a policy block is never mistaken for a
 * broken website.
 */
async function checkSite(url) {
  const origin = url ? canonicalOrigin(url) : null;
  if (!origin) return { ok: false, blocked: "No registered site origin to check" };
  return probeStatus(origin);
}
