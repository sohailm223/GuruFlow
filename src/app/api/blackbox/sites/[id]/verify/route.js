import { json, fail } from "../../../_lib";
import { getSiteById, getConnection, getEventsBySite } from "@/lib/blackbox/storage";
import { connectionHealth } from "@/lib/blackbox/sites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A test event counts as proof of delivery for this long. */
const TEST_WINDOW_MS = 5 * 60_000;

/**
 * POST /api/blackbox/sites/:id/verify
 *
 * Dashboard-side half of the connection test. The collector POSTs its test
 * event to /api/blackbox/verify; this route confirms from ScanSite's side that
 * it actually landed, so the wizard never reports success it cannot prove.
 */
export async function POST(_req, { params }) {
  const { id } = await params;

  const site = await getSiteById(id);
  if (!site) return fail(404, "Website not found");

  const [connection, events] = await Promise.all([getConnection(id), getEventsBySite(id, 50)]);
  const health = connectionHealth(site);

  const testEvent = events.find((e) => e.type === "collector_test");
  const freshTest =
    testEvent && Date.now() - testEvent.timestamp <= TEST_WINDOW_MS;

  const checks = {
    api: site.lastSeenAt ? "working" : "unreachable",
    authentication: connection?.keyHash ? "verified" : "missing",
    eventDelivery: freshTest ? "working" : site.lastEventAt ? "working" : "not_received",
    collector: health.key === "connected" ? "active" : health.key,
  };

  const passed =
    checks.api === "working" &&
    checks.authentication === "verified" &&
    checks.eventDelivery !== "not_received" &&
    checks.collector === "active";

  if (!passed) {
    return fail(409, "ScanSite could not receive the test event.", { checks });
  }

  return json({
    success: true,
    siteId: id,
    checks,
    testEventId: testEvent?.eventId ?? null,
    receivedAt: testEvent?.timestamp ?? site.lastEventAt ?? site.lastSeenAt,
  });
}
