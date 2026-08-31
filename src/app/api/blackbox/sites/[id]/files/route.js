import { json } from "../../../_lib";
import { getFilesBySite, getScansBySite } from "@/lib/blackbox/storage";
import { fileDistribution, integrityScore, categoryBreakdown } from "@/lib/blackbox/files/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/blackbox/sites/:id/files — filterable file list + aggregates. */
export async function GET(req, { params }) {
  const { id } = await params;
  const url = new URL(req.url);

  const status = url.searchParams.get("status");
  const category = url.searchParams.get("category");
  const search = (url.searchParams.get("search") ?? "").toLowerCase();
  const limit = Math.min(200, parseInt(url.searchParams.get("limit") ?? "50", 10) || 50);
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);

  let files = await getFilesBySite(id);

  const all = files;
  if (status) files = files.filter((f) => f.integrityStatus === status);
  if (category) files = files.filter((f) => f.category === category);
  if (search) {
    files = files.filter(
      (f) =>
        (f.filename ?? "").toLowerCase().includes(search) ||
        (f.relativePath ?? "").toLowerCase().includes(search) ||
        (f.signals ?? []).join(" ").toLowerCase().includes(search),
    );
  }

  const total = files.length;
  const start = (page - 1) * limit;
  const items = files.slice(start, start + limit);

  return json({
    files: items,
    total,
    page,
    limit,
    aggregates: {
      checked: all.length,
      distribution: fileDistribution(all),
      integrityScore: integrityScore(all),
      categories: categoryBreakdown(all),
    },
    scans: await getScansBySite(id, 5),
  });
}
