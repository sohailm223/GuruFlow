import { json, fail } from "../../../../_lib";
import { getFileById, getIncidentsBySite, getEventsBySite } from "@/lib/blackbox/storage";
import { relatedIncidents, levelFor } from "@/lib/blackbox/files/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/blackbox/sites/:id/files/:fileId — full file evidence for inspection. */
export async function GET(_req, { params }) {
  const { id, fileId } = await params;

  const file = await getFileById(id, fileId);
  if (!file) return fail(404, "File not found");

  const [incidents, events] = await Promise.all([
    getIncidentsBySite(id, 100),
    getEventsBySite(id, 200),
  ]);

  // Real event relationships: the events that referenced this file, in order.
  const relatedEventIds = new Set(file.relatedEvents ?? []);
  const timeline = events
    .filter((e) => relatedEventIds.has(e.eventId) || e.path === file.path)
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((e) => ({ type: e.type, timestamp: e.timestamp, id: e.eventId }));

  return json({
    file: { ...file, level: levelFor(file.riskScore ?? 0) },
    relatedIncidents: relatedIncidents(file, incidents),
    timeline,
  });
}
