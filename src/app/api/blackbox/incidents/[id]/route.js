import { json, fail, readJson } from "../../_lib";
import { getIncidentById, updateIncident, getSiteById, recordAudit } from "@/lib/blackbox/storage";

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
 * Body: { status?, note?, falsePositiveReason? }
 *   status — one of INCIDENT_STATUSES; drives the false-positive/resolved flows.
 *   note   — appended to an append-only investigation log (never rewritten).
 * A note can be added on its own; status then stays as-is.
 */
export async function PATCH(req, { params }) {
  const { id } = await params;
  const { ok, body, error, status } = await readJson(req);
  if (!ok) return fail(status ?? 400, error);

  const existing = await getIncidentById(id);
  if (!existing) return fail(404, "Incident not found");

  const note = typeof body.note === "string" ? body.note.trim() : "";
  const changingStatus = body.status !== undefined;

  if (changingStatus && !INCIDENT_STATUSES.includes(body.status)) {
    return fail(400, `status must be one of: ${INCIDENT_STATUSES.join(", ")}`);
  }
  if (!changingStatus && !note) {
    return fail(400, "Provide status and/or note");
  }

  const nextStatus = changingStatus ? body.status : existing.status;
  const patch = { status: nextStatus, statusUpdatedAt: Date.now() };

  // Append-only investigation notes.
  if (note) {
    patch.notes = [...(existing.notes ?? []), { at: Date.now(), text: note.slice(0, 1000) }].slice(-100);
    patch.statusNote = note.slice(0, 500);
  }

  // A false positive should carry a reason so the decision is auditable.
  if (nextStatus === "false_positive" && typeof body.falsePositiveReason === "string" && body.falsePositiveReason.trim()) {
    patch.falsePositiveReason = body.falsePositiveReason.trim().slice(0, 500);
  }
  if (nextStatus === "false_positive" && changingStatus && !patch.falsePositiveReason && !existing.falsePositiveReason) {
    return fail(400, "A reason is required before marking an incident as a false positive");
  }

  const incident = await updateIncident(id, patch);

  await recordAudit({
    action: nextStatus === "false_positive" && changingStatus
      ? "incident_false_positive"
      : note && !changingStatus
        ? "incident_note"
        : "incident_status",
    incidentId: id,
    siteId: existing.siteId,
    from: existing.status,
    to: nextStatus,
    note: note ? note.slice(0, 200) : undefined,
    reason: patch.falsePositiveReason ?? undefined,
  });

  return json({ incident });
}
