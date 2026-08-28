import { NextResponse } from "next/server";
import { gateEnabled, verifySession, GATE_COOKIE } from "@/lib/blackbox/gate";

/**
 * Collector-facing endpoints authenticate with the per-site collector key (or
 * a single-use pairing code), so they must stay reachable even when the
 * dashboard gate is on. Everything else — pages and read APIs — is gated.
 */
const OPEN_API = new Set([
  "/api/blackbox/ingest",
  "/api/blackbox/heartbeat",
  "/api/blackbox/connect",
  "/api/blackbox/verify",
  "/api/blackbox/login",
]);

export async function middleware(req) {
  if (!gateEnabled()) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (OPEN_API.has(pathname) || pathname === "/login") return NextResponse.next();

  if (await verifySession(req.cookies.get(GATE_COOKIE)?.value)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico|css|js)$).*)"],
};
