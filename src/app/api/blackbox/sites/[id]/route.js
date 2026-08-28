import { json, fail, readJson } from "../../_lib";
import {
  getSiteById,
  updateSite,
  deleteSite,
  getIncidentsBySite,
  getEventsBySite,
  deleteIncidentsBySite,
  deleteEventsBySite,
  getConnection,
  recordAudit,
} from "@/lib/blackbox/storage";
import { connectionHealth } from "@/lib/blackbox/sites";
import { publicConnection } from "@/lib/blackbox/connection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/blackbox/sites/:id — website detail with derived health. */
export async function GET(_req, { params }) {
  const { id } = await params;
  const site = await getSiteById(id);
  if (!site) return fail(404, "Website not found");

  const [incidents, events, connection] = await Promise.all([
    getIncidentsBySite(id, 100),
    getEventsBySite(id, 50),
    getConnection(id),
  ]);

  return json({
    site,
    health: connectionHealth(site),
    connection: publicConnection(connection),
    incidents,
    events,
  });
}

/** PATCH /api/blackbox/sites/:id — rename, change environment, etc. */
export async function PATCH(req, { params }) {
  const { id } = await params;
  const { ok, body, error, status } = await readJson(req);
  if (!ok) return fail(status ?? 400, error);

  const existing = await getSiteById(id);
  if (!existing) return fail(404, "Website not found");

  const allowed = {};
  if (typeof body.name === "string" && body.name.trim()) allowed.name = body.name.trim();
  if (["production", "staging", "development"].includes(body.environment)) {
    allowed.environment = body.environment;
  }

  if (!Object.keys(allowed).length) return fail(400, "No valid fields to update");

  const site = await updateSite(id, allowed);
  return json({ site });
}

/**
 * DELETE /api/blackbox/sites/:id
 *
 * Distinct from disconnect: this removes the website and, when
 * ?purge=true is passed, its locally stored events and incidents.
 */
export async function DELETE(req, { params }) {
  const { id } = await params;

  const existing = await getSiteById(id);
  if (!existing) return fail(404, "Website not found");

  const purge = new URL(req.url).searchParams.get("purge") === "true";

  let removed = { incidents: 0, events: 0 };
  if (purge) {
    removed = {
      incidents: await deleteIncidentsBySite(id),
      events: await deleteEventsBySite(id),
    };
  }

  await deleteSite(id);
  await recordAudit({ action: "site_deleted", siteId: id, name: existing.name, purge });
  return json({ deleted: true, siteId: id, purge, removed });
}
