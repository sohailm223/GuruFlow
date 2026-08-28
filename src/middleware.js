import { NextResponse } from "next/server";
import { adminConfigured, verifySession, GATE_COOKIE } from "@/lib/blackbox/gate";

/**
 * Dashboard authentication is MANDATORY.
 *
 * Collector-facing endpoints authenticate with the per-site collector key plus
 * a required HMAC request signature, so they stay reachable without an admin
 * session. Everything else — pages and management APIs — requires a valid
 * session cookie.
 *
 * When no admin password is configured the dashboard fails CLOSED: pages are
 * sent to /login (which explains the required env var) and APIs return 401.
 */
const OPEN_API = new Set([
  "/api/blackbox/ingest",
  "/api/blackbox/heartbeat",
  "/api/blackbox/verify",
  "/api/blackbox/connect",
  "/api/blackbox/rotate",
  "/api/blackbox/login",
]);

export async function middleware(req) {
  const { pathname } = req.nextUrl;
  if (OPEN_API.has(pathname) || pathname === "/login") return NextResponse.next();

  if (await verifySession(req.cookies.get(GATE_COOKIE)?.value)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: adminConfigured() ? "Unauthorized" : "Admin credentials not configured" },
      { status: 401 },
    );
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = adminConfigured()
    ? `?next=${encodeURIComponent(pathname)}`
    : `?setup=1&next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico|css|js)$).*)"],
};
