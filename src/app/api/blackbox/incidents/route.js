import { NextResponse } from "next/server";
import { listIncidents, listSites } from "@/lib/incidents/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/blackbox/incidents?site=&limit=
 */
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const site = searchParams.get("site") ?? undefined;
  const limit = Math.min(200, Number(searchParams.get("limit") ?? 100));

  const [incidents, sites] = await Promise.all([
    listIncidents({ site, limit }),
    listSites(),
  ]);

  return NextResponse.json({ sites, incidents });
}
