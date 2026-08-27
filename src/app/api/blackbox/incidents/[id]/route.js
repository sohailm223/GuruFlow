import { NextResponse } from "next/server";
import { getIncident } from "@/lib/incidents/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/blackbox/incidents/:id
 */
export async function GET(_req, { params }) {
  const { id } = await params;
  const incident = await getIncident(id);

  if (!incident) {
    return NextResponse.json({ error: "Incident not found" }, { status: 404 });
  }

  return NextResponse.json(incident);
}
