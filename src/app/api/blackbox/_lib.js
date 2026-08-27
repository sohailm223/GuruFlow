import { NextResponse } from "next/server";

/** All Black Box routes run on Node — the storage driver needs the filesystem. */
export const blackboxRuntime = "nodejs";

export function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

export function fail(status, error, extra = {}) {
  return NextResponse.json({ error, ...extra }, { status });
}

/** Parse a JSON body without throwing on malformed input. */
export async function readJson(req) {
  const raw = await req.text();
  if (!raw) return { ok: true, body: {}, raw };
  try {
    return { ok: true, body: JSON.parse(raw), raw };
  } catch {
    return { ok: false, error: "body must be valid JSON", raw };
  }
}
