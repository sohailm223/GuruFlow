import { json, fail, readJson } from "../_lib";
import { getSiteById, updateSite } from "@/lib/blackbox/storage";
import { redeemConnectionCode } from "@/lib/blackbox/connection";
import { normalizeSiteUrl } from "@/lib/blackbox/sites";

export const runtime = "nodejs";

/**
 * POST /api/blackbox/connect
 *
 * Called by the WordPress collector once, with the pairing code a human typed
 * into the plugin screen.
 *
 * Body: { code, siteUrl, wordpress: { version, phpVersion, pluginVersion, … } }
 *
 * Returns the permanent collector key exactly once. The pairing code is
 * consumed whether or not the rest of the exchange succeeds, and is never
 * valid for event delivery afterwards.
 */
export async function POST(req) {
  const { ok, body, error } = await readJson(req);
  if (!ok) return fail(400, error);

  const siteUrl = normalizeSiteUrl(body.siteUrl);
  if (!siteUrl) return fail(400, "Enter a valid website URL");

  const result = await redeemConnectionCode({
    code: body.code,
    siteUrl,
    wordpress: sanitizeWordpress(body.wordpress),
  });

  if (!result.ok) return fail(result.status, result.error);

  const expected = await getSiteById(result.siteId);
  if (!expected) return fail(404, "Website not found");

  // Best-effort match: warn rather than hard-fail, because a site can be
  // reached through several hostnames (www, staging aliases, etc.).
  const mismatch = expected.url && normalizeSiteUrl(expected.url) !== siteUrl;

  const site = await updateSite(result.siteId, {
    connectionStatus: "connected",
    monitoringStatus: "active",
    connectedAt: result.connectedAt,
    lastSeenAt: Date.now(),
    url: siteUrl,
    host: new URL(siteUrl).host,
    collectorVersion: body.wordpress?.pluginVersion ?? null,
    wordpress: sanitizeWordpress(body.wordpress),
    capability: sanitizeCapability(body.wordpress),
  });

  return json({
    success: true,
    siteId: result.siteId,
    collectorKey: result.collectorKey,
    connectedAt: result.connectedAt,
    endpoint: process.env.NEXT_PUBLIC_SCANSITE_BASE_URL || "",
    warnings: mismatch
      ? [
          `Connected as ${siteUrl}, but ScanSite has ${expected.url} on record. Update the website record if this is unexpected.`,
        ]
      : [],
  });
}

/** Only keep environment facts — never configuration values or secrets. */
function sanitizeWordpress(wp) {
  if (!wp || typeof wp !== "object") return null;
  return {
    wordpressVersion: str(wp.version ?? wp.wordpressVersion),
    phpVersion: str(wp.phpVersion),
    pluginVersion: str(wp.pluginVersion),
    multisite: Boolean(wp.multisite),
    siteUrl: str(wp.siteUrl),
    homeUrl: str(wp.homeUrl),
  };
}

function sanitizeCapability(wp) {
  if (!wp || typeof wp !== "object") return null;
  const theme = wp.theme && typeof wp.theme === "object" ? wp.theme : null;
  const plugins = wp.plugins && typeof wp.plugins === "object" ? wp.plugins : null;

  return {
    theme: theme ? { name: str(theme.name), version: str(theme.version) } : null,
    plugins: plugins
      ? {
          active: num(plugins.active),
          inactive: num(plugins.inactive),
        }
      : null,
  };
}

function str(v) {
  return typeof v === "string" && v.length <= 200 ? v : null;
}
function num(v) {
  return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : null;
}
