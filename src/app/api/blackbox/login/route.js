import { NextResponse } from "next/server";
import {
  adminConfigured,
  adminUsername,
  verifyLogin,
  createSession,
  GATE_COOKIE,
  SESSION_MS,
} from "@/lib/blackbox/gate";

/**
 * Exchange the local admin username + password for a stateless session cookie.
 * Dashboard authentication is mandatory: when no admin password is configured
 * the endpoint reports 503 so the operator knows to set SCANSITE_ADMIN_PASSWORD.
 */
export async function POST(req) {
  if (!adminConfigured()) {
    return NextResponse.json(
      { error: "Admin credentials not configured. Set SCANSITE_ADMIN_PASSWORD on the server." },
      { status: 503 },
    );
  }

  let username, password;
  try {
    ({ username, password } = await req.json());
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  if (!(await verifyLogin(username, password))) {
    return NextResponse.json({ error: "Incorrect username or password" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true, username: adminUsername() });
  res.cookies.set(GATE_COOKIE, await createSession(), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MS / 1000,
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}
