import { json, fail, readJson } from "../_lib";
import { authenticateCollector } from "@/lib/blackbox/auth";
import { acceptKeyRotation } from "@/lib/blackbox/connection";

export const runtime = "nodejs";

/**
 * POST /api/blackbox/rotate
 *
 * WordPress-initiated key rotation. The plugin generates a fresh collector key
 * locally and calls this endpoint, authenticated with the CURRENT key (HMAC
 * signed). Only the replacement key travels in the body; ScanSite stores just
 * its SHA-256 hash and never the raw secret, which is never displayed.
 *
 * Body: { newCollectorKey: "sk_bb_…" }
 */
export async function POST(req) {
  const { ok, body, raw, error } = await readJson(req);
  if (!ok) return fail(400, error);

  const auth = await authenticateCollector(req, raw);
  if (!auth.ok) return fail(auth.status, auth.error);

  const result = await acceptKeyRotation(auth.site.id, body?.newCollectorKey);
  if (!result.ok) return fail(result.status, result.error);

  return json({ success: true, siteId: auth.site.id, rotatedAt: result.rotatedAt });
}
