import { json, fail, readJson } from "../_lib";
import { getSites } from "@/lib/blackbox/storage";
import { createSiteRecord, normalizeSiteUrl } from "@/lib/blackbox/sites";
import { issueConnectionCode } from "@/lib/blackbox/connection";
import { createSite } from "@/lib/blackbox/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/blackbox/sites — list every website. */
export async function GET() {
  const sites = await getSites();
  return json({ sites });
}

/**
 * POST /api/blackbox/sites — register a website and issue a pairing code.
 *
 * Body: { name, url, environment? }
 * The permanent collector key is NOT created here; that only happens when the
 * WordPress plugin redeems the code via /api/blackbox/connect.
 */
export async function POST(req) {
  const { ok, body, error } = await readJson(req);
  if (!ok) return fail(400, error);

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return fail(400, "Website name is required");
  if (name.length > 120) return fail(400, "Website name is too long");

  const url = normalizeSiteUrl(body.url);
  if (!url) return fail(400, "Enter a valid website URL, e.g. https://example.com");

  const site = createSiteRecord({ name, url, environment: body.environment });
  await createSite(site);

  const pairing = await issueConnectionCode(site.id);

  return json({ site, connection: pairing }, 201);
}
