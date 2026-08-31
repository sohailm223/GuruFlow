import { json } from "../_lib";
import { getAudit, storageInfo } from "@/lib/blackbox/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/blackbox/audit — local management audit trail.
 *
 * Append-only, newest first. Records admin logins, site add/delete,
 * disconnect/reconnect, key rotation, incident status changes, false-positive
 * verdicts and trusted-file changes. Collector endpoints are deliberately not
 * logged here — that traffic is high volume and belongs in the per-site event
 * feed, not in the management audit trail.
 *
 * Protected by the dashboard session middleware (this path is not in OPEN_API).
 */
export async function GET(req) {
  const requested = Number(new URL(req.url).searchParams.get("limit"));
  const limit = Number.isFinite(requested) ? Math.min(500, Math.max(1, Math.floor(requested))) : 100;
  return json({ entries: await getAudit(limit), storage: storageInfo() });
}
