import { json } from "../_lib";
import { generateDemoData } from "@/lib/blackbox/demo";
import { getIncidentsBySite } from "@/lib/blackbox/storage";
import { publicIncidentSummary } from "@/lib/blackbox/ingest";

export const runtime = "nodejs";

/**
 * GET|POST /api/blackbox/demo
 *
 * Creates the demo websites (namespaced site_demo_…) and pushes their events
 * through the real ingest pipeline. Demo data never touches connected sites.
 *
 * GET is supported so the flow can be exercised straight from a browser.
 */
async function run() {
  const result = await generateDemoData();

  const incidents = [];
  for (const siteId of result.sites) {
    for (const incident of await getIncidentsBySite(siteId, 20)) {
      incidents.push(publicIncidentSummary(incident));
    }
  }

  return json({
    success: true,
    sites: result.sites,
    incidents: incidents.sort((a, b) => b.startedAt - a.startedAt),
  });
}

export const GET = run;
export const POST = run;
