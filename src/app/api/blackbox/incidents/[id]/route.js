import { json, fail, readJson } from "../../_lib";
import { getIncidentById, updateIncident, getSiteById } from "@/lib/blackbox/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const INCIDENT_STATUSES = [
  "new",
  "investigating",
  "confirmed",
  "false_positive",
  "remediated",
  "monitoring",
  "resolved",
];

/** GET /api/blackbox/incidents/:id */
export async function GET(_req, { params }) {
  const { id } = await params;
  const incident = await getIncidentById(id);
  if (!incident) return fail(404, "Incident not found");

  const site = await getSiteById(incident.siteId);
  return json({ incident, site });
}

/**
 * PATCH /api/blackbox/incidents/:id
 *
 * Body: { status } — one of INCIDENT_STATUSES. This is what drives the
 * false-positive and resolved flows.
 */
export async function PATCH(req, { params }) {
  const { id } = await params;
  const { ok, body, error } = await readJson(req);
  if (!ok) return fail(400, error);

  const existing = await getIncidentById(id);
  if (!existing) return fail(404, "Incident not found");

  if (!INCIDENT_STATUSES.includes(body.status)) {
    return fail(400, `status must be one of: ${INCIDENT_STATUSES.join(", ")}`);
  }

  const incident = await updateIncident(id, {
    status: body.status,
    statusUpdatedAt: Date.now(),
    statusNote: typeof body.note === "string" ? body.note.slice(0, 500) : undefined,
  });

  return json({ incident });
}
