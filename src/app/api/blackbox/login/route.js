import { NextResponse } from "next/server";
import {
  gateEnabled,
  checkPassword,
  createSession,
  GATE_COOKIE,
  SESSION_MS,
} from "@/lib/blackbox/gate";

/**
 * Exchange the shared gate password for a stateless session cookie.
 * Returns 404 when the gate is disabled so the endpoint isn't probeable.
 */
export async function POST(req) {
  if (!gateEnabled()) {
    return NextResponse.json({ error: "Gate disabled" }, { status: 404 });
  }

  let password;
  try {
    ({ password } = await req.json());
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  if (!(await checkPassword(password))) {
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(GATE_COOKIE, await createSession(), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MS / 1000,
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}
