import { json, fail, readJson } from "../../../../_lib";
import {
  getSiteById,
  getTrustedBySite,
  addTrustedFile,
  removeTrustedFile,
  recordAudit,
} from "@/lib/blackbox/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SHA_RE = /^[0-9a-f]{64}$/i;

/** GET /api/blackbox/sites/:id/files/trusted — list trusted entries. */
export async function GET(_req, { params }) {
  const { id } = await params;
  const site = await getSiteById(id);
  if (!site) return fail(404, "Website not found");
  return json({ trusted: await getTrustedBySite(id) });
}

/**
 * POST — trust a file by path + SHA-256. If the file's hash later changes, the
 * trust entry is automatically expired by the ingest hook and the file returns
 * to normal integrity handling.
 */
export async function POST(req, { params }) {
  const { id } = await params;
  const site = await getSiteById(id);
  if (!site) return fail(404, "Website not found");

  const { ok, body, error, status } = await readJson(req);
  if (!ok) return fail(status ?? 400, error);

  const relativePath = String(body.relativePath ?? "").replace(/^\/+/, "").slice(0, 500);
  const sha256 = String(body.sha256 ?? "").toLowerCase();
  if (!relativePath) return fail(400, "relativePath is required");
  if (!SHA_RE.test(sha256)) return fail(400, "sha256 must be a 64-char hex digest");

  const rec = await addTrustedFile(id, {
    relativePath,
    sha256,
    reason: typeof body.reason === "string" ? body.reason.slice(0, 300) : null,
  });
  await recordAudit({ action: "trusted_file_added", siteId: id, path: relativePath });

  return json({ trusted: rec }, 201);
}

/** DELETE — remove a trusted entry by id (query ?id=). */
export async function DELETE(req, { params }) {
  const { id } = await params;
  const tid = new URL(req.url).searchParams.get("id");
  if (!tid) return fail(400, "id is required");
  const removed = await removeTrustedFile(tid);
  await recordAudit({ action: "trusted_file_removed", siteId: id, trustedId: tid });
  return json({ removed });
}
