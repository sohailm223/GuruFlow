import { json, fail, readJson } from "../_lib";
import { authenticateCollector } from "@/lib/blackbox/auth";
import { collectorRateLimit } from "@/lib/blackbox/ratelimit";
import { ingestEvents } from "@/lib/blackbox/ingest";

export const runtime = "nodejs";

/**
 * POST /api/blackbox/ingest
 *
 * Auth: X-ScanSite-Site + X-ScanSite-Key (never credentials in the query
 * string). Optionally X-ScanSite-Timestamp + X-ScanSite-Signature when the
 * collector signs requests.
 *
 * Body: { site, events: [ …up to 100 ] }
 */
export async function POST(req) {
  const { ok: parsed, body, raw, error, status } = await readJson(req);
  if (!parsed) return fail(status ?? 400, error);

  const auth = await authenticateCollector(req, raw);
  if (!auth.ok) return fail(auth.status, auth.error);

  if (!collectorRateLimit(auth.site.id)) return fail(429, "Too many requests");

  const result = await ingestEvents(auth.site.id, body);
  if (!result.ok) {
    return fail(result.status, result.error, { rejected: result.rejected });
  }

  return json({
    success: true,
    siteId: auth.site.id,
    accepted: result.accepted,
    duplicates: result.duplicates,
    rejected: result.rejected,
    incidents: result.incidents,
  });
}
