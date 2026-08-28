import { json, fail } from "../../../_lib";
import { getSiteById } from "@/lib/blackbox/storage";
import { requestKeyRotation } from "@/lib/blackbox/connection";

export const runtime = "nodejs";

/**
 * POST /api/blackbox/sites/:id/rotate-key
 *
 * Dashboard-initiated rotation. ScanSite never generates or returns the raw
 * secret: this only flags the connection. The next collector heartbeat receives
 * `command.rotateKey`, the WordPress plugin generates a fresh key locally and
 * pushes it back via /api/blackbox/rotate. The old key keeps working until the
 * plugin confirms the rotation, so the site is never silently broken.
 */
export async function POST(_req, { params }) {
  const { id } = await params;

  const site = await getSiteById(id);
  if (!site) return fail(404, "Website not found");

  const result = await requestKeyRotation(id);
  if (!result.ok) return fail(result.status, result.error);

  return json({
    siteId: id,
    requested: true,
    info: "Rotation requested. The WordPress plugin will generate a new key on its next heartbeat and apply it automatically. The current key keeps working until then.",
  });
}
