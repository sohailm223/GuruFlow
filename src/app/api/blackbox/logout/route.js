import { NextResponse } from "next/server";
import { adminUsername, GATE_COOKIE } from "@/lib/blackbox/gate";
import { recordAudit } from "@/lib/blackbox/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clientIp(req) {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "local"
  );
}

/**
 * POST /api/blackbox/logout — end the admin session.
 *
 * Sessions are stateless HMAC cookies, so there is nothing server-side to
 * destroy; the cookie is cleared and the action is written to the audit log.
 * This route is deliberately open in the middleware: logging out must still work
 * with an expired or invalid cookie, and it performs no privileged action.
 */
export async function POST(req) {
  await recordAudit({ action: "logout", actor: adminUsername(), ip: clientIp(req) });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(GATE_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
