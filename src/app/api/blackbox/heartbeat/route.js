import { json, fail, readJson } from "../_lib";
import { authenticateCollector } from "@/lib/blackbox/auth";
import { updateSite } from "@/lib/blackbox/storage";
import { connectionHealth } from "@/lib/blackbox/sites";

export const runtime = "nodejs";

/**
 * POST /api/blackbox/heartbeat
 *
 * "I am alive." Sent by the collector roughly every 5 minutes via WP-Cron.
 * Updates lastSeenAt, which is what the connection status is derived from.
 */
export async function POST(req) {
  const { ok: parsed, body, raw, error } = await readJson(req);
  if (!parsed) return fail(400, error);

  const auth = await authenticateCollector(req, raw);
  if (!auth.ok) return fail(auth.status, auth.error);

  const patch = { lastSeenAt: Date.now() };

  if (typeof body?.pluginVersion === "string") patch.collectorVersion = body.pluginVersion;
  if (body?.wordpressVersion || body?.wordpress) {
    patch.wordpress = {
      ...(auth.site.wordpress ?? {}),
      wordpressVersion:
        body.wordpressVersion ?? body.wordpress?.version ?? auth.site.wordpress?.wordpressVersion,
      phpVersion: body.phpVersion ?? auth.site.wordpress?.phpVersion,
      pluginVersion: body.pluginVersion ?? auth.site.wordpress?.pluginVersion,
    };
  }

  const site = await updateSite(auth.site.id, patch);

  return json({
    success: true,
    siteId: auth.site.id,
    lastSeenAt: site.lastSeenAt,
    health: connectionHealth(site),
  });
}
