import { json, fail } from "../../../_lib";
import { getSiteById, updateSite, recordAudit } from "@/lib/blackbox/storage";
import { revokeCollectorKey, issueConnectionCode } from "@/lib/blackbox/connection";

export const runtime = "nodejs";

/**
 * POST /api/blackbox/sites/:id/reconnect
 *
 * Issues a fresh pairing code. Old permanent secrets are never reused — the
 * WordPress plugin must be re-paired with the new code.
 */
export async function POST(_req, { params }) {
  const { id } = await params;

  const site = await getSiteById(id);
  if (!site) return fail(404, "Website not found");

  await revokeCollectorKey(id);
  const pairing = await issueConnectionCode(id);

  const updated = await updateSite(id, {
    connectionStatus: "pending",
    monitoringStatus: "inactive",
  });
  await recordAudit({ action: "reconnect", siteId: id, name: site.name });

  return json({ site: updated, connection: pairing });
}
