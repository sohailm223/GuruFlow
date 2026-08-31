import { json, fail } from "../../../_lib";
import { recordAudit } from "@/lib/blackbox/storage";
import { getSiteById, updateSite } from "@/lib/blackbox/storage";
import { revokeCollectorKey } from "@/lib/blackbox/connection";

export const runtime = "nodejs";

/**
 * POST /api/blackbox/sites/:id/disconnect
 *
 * Stops accepting events from this WordPress site and invalidates its key.
 * Existing incidents and events are kept — use DELETE with ?purge=true to
 * remove local data.
 */
export async function POST(_req, { params }) {
  const { id } = await params;

  const site = await getSiteById(id);
  if (!site) return fail(404, "Website not found");

  await revokeCollectorKey(id);
  const updated = await updateSite(id, {
    connectionStatus: "disconnected",
    monitoringStatus: "inactive",
    disconnectedAt: Date.now(),
  });
  await recordAudit({ action: "disconnect", siteId: id, name: site.name });

  return json({ site: updated, message: "Website disconnected. Existing incidents remain available." });
}
