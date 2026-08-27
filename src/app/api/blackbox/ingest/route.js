import crypto from "crypto";
import { NextResponse } from "next/server";
import { ingestEvents } from "@/lib/incidents/ingest";

export const runtime = "nodejs";

/**
 * POST /api/blackbox/ingest
 *
 * Body: { site: "https://example.com", events: [ ...BlackBoxEvent ] }
 *
 * Auth: if BLACKBOX_INGEST_SECRET is set, the request must carry
 *       x-blackbox-signature: sha256=<HMAC-SHA256 of the raw body>.
 *       Public otherwise (dev convenience).
 */
export async function POST(req) {
  const raw = await req.text();

  const authError = verifySignature(raw, req.headers.get("x-blackbox-signature"));
  if (authError) {
    return NextResponse.json({ error: authError }, { status: 401 });
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "body must be valid JSON" }, { status: 400 });
  }

  const result = await ingestEvents(payload);
  if (!result.ok) {
    return NextResponse.json({ error: result.error, rejected: result.rejected }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    site: result.site,
    accepted: result.accepted,
    rejected: result.rejected,
    incidents: result.incidents.map((i) => ({
      id: i.id,
      startedAt: i.startedAt,
      endedAt: i.endedAt,
      eventCount: i.eventCount,
      risk: i.risk,
      headline: i.headline,
      likelyCause: i.likelyCause,
    })),
  });
}

function verifySignature(rawBody, header) {
  const secret = process.env.BLACKBOX_INGEST_SECRET;
  if (!secret) return null; // signature checking disabled
  if (!header) return "missing x-blackbox-signature header";

  const expected = `sha256=${crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex")}`;

  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return "invalid signature";
  }
  return null;
}
