import { NextResponse } from "next/server";

/** All Black Box routes run on Node — the storage driver needs the filesystem. */
export const blackboxRuntime = "nodejs";

export function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

export function fail(status, error, extra = {}) {
  return NextResponse.json({ error, ...extra }, { status });
}

/** Hard cap on request body size so a hostile collector can't exhaust memory. */
export const MAX_BODY_BYTES = 1_000_000; // 1 MB

/**
 * Parse a JSON body without throwing on malformed or oversized input.
 *
 * Oversized requests are rejected with 413 (not 400) so a client can tell
 * "too big" from "malformed". Note the Content-Length check happens before the
 * body is read; the length check afterwards catches chunked requests that lie
 * about their size. A determined attacker can still make the server buffer up
 * to whatever the HTTP layer accepts before this runs — the cap bounds our own
 * parsing and storage, it is not a substitute for a proxy-level body limit.
 */
export async function readJson(req) {
  const declared = Number(req.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return { ok: false, status: 413, error: "Request body too large", raw: "" };
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return { ok: false, status: 413, error: "Request body too large", raw: "" };
  }
  if (!raw) return { ok: true, body: {}, raw };
  try {
    return { ok: true, body: JSON.parse(raw), raw };
  } catch {
    return { ok: false, status: 400, error: "body must be valid JSON", raw };
  }
}
