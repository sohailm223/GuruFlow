import { json, fail, readJson } from "../_lib";
import { authenticateCollector } from "@/lib/blackbox/auth";
import { collectorRateLimit } from "@/lib/blackbox/ratelimit";
import { ingestTestEvent } from "@/lib/blackbox/ingest";

export const runtime = "nodejs";

/**
 * POST /api/blackbox/verify
 *
 * The collector sends one small test event. Reaching this handler at all
 * proves API connection + authentication; storing the event proves delivery.
 *
 * Auth: X-ScanSite-Site + X-ScanSite-Key
 */
export async function POST(req) {
  const { ok: parsed, body, raw, error, status } = await readJson(req);
  if (!parsed) return fail(status ?? 400, error);

  const auth = await authenticateCollector(req, raw);
  if (!auth.ok) return fail(auth.status, auth.error);

  if (!collectorRateLimit(auth.site.id)) return fail(429, "Too many requests");

  const result = await ingestTestEvent(auth.site.id, {
    eventId: body.eventId,
    type: "collector_test",
    category: "core",
    timestamp: body.timestamp ?? new Date().toISOString(),
    metadata: {
      message: body.message || "Collector connection test",
      pluginVersion: body.pluginVersion ?? null,
      wordpressVersion: body.wordpressVersion ?? null,
    },
  });

  if (!result.ok) return fail(result.status, result.error);

  return json({
    success: true,
    siteId: auth.site.id,
    eventId: result.eventId,
    duplicate: result.duplicate,
    receivedAt: result.receivedAt,
    checks: {
      api: "working",
      authentication: "verified",
      eventDelivery: "working",
      collector: "active",
    },
  });
}
