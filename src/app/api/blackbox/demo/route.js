import { NextResponse } from "next/server";
import { ingestEvents } from "@/lib/incidents/ingest";
import { DEMO_SITE, buildDemoEvents } from "@/lib/incidents/demoScenario";

export const runtime = "nodejs";

/**
 * GET|POST /api/blackbox/demo
 *
 * Loads the reference compromise scenario so the timeline can be reviewed
 * without a live WordPress collector attached. GET is supported so the
 * correlation output can be inspected straight from a browser.
 *
 * Public by design (see middleware publicRoutes); it writes only demo data
 * for DEMO_SITE.
 */
async function runDemo(req) {
  let site = DEMO_SITE;

  const raw = await req.text();
  if (raw) {
    try {
      const body = JSON.parse(raw);
      if (typeof body?.site === "string" && body.site.trim()) site = body.site.trim();
    } catch {
      return NextResponse.json({ error: "body must be valid JSON or empty" }, { status: 400 });
    }
  }

  const result = await ingestEvents({ site, events: buildDemoEvents() });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    site: result.site,
    accepted: result.accepted,
    incidents: result.incidents.map((i) => ({
      id: i.id,
      startedAt: i.startedAt,
      endedAt: i.endedAt,
      eventCount: i.eventCount,
      risk: i.risk,
      score: i.score,
      headline: i.headline,
      likelyCause: i.likelyCause,
    })),
  });
}

export const GET = runDemo;
export const POST = runDemo;
