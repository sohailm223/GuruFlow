import { NextResponse } from "next/server";
import { analyzeOnly } from "@/lib/incidents/ingest";

export const runtime = "nodejs";

/**
 * POST /api/blackbox/analyze
 *
 * Dry run: same correlation engine as /ingest, nothing stored.
 * Body: { site, events: [...] }
 */
export async function POST(req) {
  let payload;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "body must be valid JSON" }, { status: 400 });
  }

  const result = analyzeOnly(payload);
  if (!result.ok) {
    return NextResponse.json({ error: result.error, rejected: result.rejected }, { status: 400 });
  }

  return NextResponse.json(result);
}
