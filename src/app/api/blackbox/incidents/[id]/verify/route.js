import { json, fail } from "../../../_lib";
import { getIncidentById, updateIncident, getEventsBySite, getFilesBySite, getSiteById, recordAudit } from "@/lib/blackbox/storage";
import { evaluateVerification } from "@/lib/blackbox/remediation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FETCH_TIMEOUT_MS = 6000;

/**
 * POST /api/blackbox/incidents/:id/verify
 *
 * Re-checks what ScanSite can actually re-check after a fix:
 *   - account removal / role change   (from collector events)
 *   - suspicious file gone            (file_deleted event or integrity record)
 *   - cron hook removed               (cron_removed / cron_modified)
 *   - file integrity scan             (latest scan completed with 0 critical)
 *   - website availability            (ScanSite fetches the site URL)
 *
 * ScanSite changes nothing on the WordPress site. The only outbound request is a
 * single GET of the site's own URL to report its HTTP status; redirects are not
 * followed, so a hijacked redirect shows up as a non-200 rather than being
 * silently followed to someone else's domain.
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

  const updated = await updateIncident(id, { verification });

  await recordAudit({
    action: "incident_verification",
    incidentId: id,
    siteId: incident.siteId,
    detail: `${verification.resolved}/${verification.total} checks passed`,
  });

  return json({ incident: updated, verification });
}

/** GET /api/blackbox/incidents/:id/verify — the last verification result. */
export async function GET(_req, { params }) {
  const { id } = await params;
  const incident = await getIncidentById(id);
  if (!incident) return fail(404, "Incident not found");
  return json({ verification: incident.verification ?? null });
}

async function checkSite(url) {
  if (!url) return { ok: false, error: "No site URL recorded" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: "GET", redirect: "manual", signal: controller.signal });
    return { ok: res.status === 200, status: res.status };
  } catch (err) {
    return { ok: false, error: err?.name === "AbortError" ? "timed out" : "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}
