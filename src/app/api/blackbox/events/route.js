import { json } from "../_lib";
import { getEvents, getEventsBySite } from "@/lib/blackbox/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/blackbox/events?site=&limit=
 *
 * Raw event feed, newest first. Powers "Recent Activity" on a website.
 */
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const site = searchParams.get("site");
  const limit = Math.min(500, Number(searchParams.get("limit") ?? 100));

  const events = site ? await getEventsBySite(site, limit) : await getEvents(limit);
  return json({ events });
}
