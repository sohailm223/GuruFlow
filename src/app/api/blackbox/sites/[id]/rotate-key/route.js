import { json, fail } from "../../../_lib";
import { getSiteById } from "@/lib/blackbox/storage";
import { rotateCollectorKey } from "@/lib/blackbox/connection";

export const runtime = "nodejs";

/**
 * POST /api/blackbox/sites/:id/rotate-key
 *
 * Issues a new permanent collector secret and returns it exactly once.
 *
 * The old key stops working immediately, so the WordPress side must be
 * updated. Automatic rotation sync (ScanSite issues a rotation token that
 * WordPress exchanges) is not implemented in this MVP — the response carries
 * explicit reconnection instructions rather than silently breaking the site.
 */
export async function POST(_req, { params }) {
  const { id } = await params;

  const site = await getSiteById(id);
  if (!site) return fail(404, "Website not found");

  const result = await rotateCollectorKey(id);
  if (!result.ok) return fail(result.status, result.error);

  return json({
    siteId: id,
    collectorKey: result.collectorKey,
    rotatedAt: result.rotatedAt,
    warning:
      "The previous collector key no longer works. Reconnect the WordPress plugin with a new connection code, or update its stored key.",
    nextSteps: [
      "Open WordPress → ScanSite Black Box",
      "Choose Reconnect and enter the new connection code",
      "Save the new collector key when it is shown once",
    ],
  });
}
