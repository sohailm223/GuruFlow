import { json, fail, readJson } from "../../../../_lib";
import { getSiteById, updateSite, addScan } from "@/lib/blackbox/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/blackbox/sites/:id/files/scan — request a manual scan.
 *
 * ScanSite cannot read a remote WordPress filesystem, so this only records the
 * request. The collector polls for it via the heartbeat command channel and
 * runs the bounded scan itself on WP-Cron; progress arrives as events.
 */
export async function POST(req, { params }) {
  const { id } = await params;
  const site = await getSiteById(id);
  if (!site) return fail(404, "Website not found");

  const { ok, body } = await readJson(req);
  const mode = ok && body?.mode === "deep" ? "deep" : "quick";

  await updateSite(id, { pendingScan: mode });
  const scan = await addScan({
    siteId: id,
    mode,
    status: "requested",
    requestedAt: Date.now(),
  });

  return json({ ok: true, scan, note: "The collector will start this scan on its next heartbeat." });
}
