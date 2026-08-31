/**
 * Mandatory local-admin authentication for the whole dashboard.
 *
 * There are no accounts and no external provider (no Clerk / Auth0 / NextAuth /
 * Supabase / Firebase). A single local administrator is configured through the
 * environment and every page + management API requires a valid session cookie.
 *
 *   SCANSITE_ADMIN_USER      username (default "admin")
 *   SCANSITE_ADMIN_PASSWORD  required — when unset the dashboard is locked out
 *                            (fail closed) and /login explains how to configure it.
 *   SCANSITE_GATE_PASSWORD   legacy alias for the password, kept for older deploys.
 *
 * Sessions are stateless HMAC cookies keyed by the configured password, so no
 * store or Redis is required. Uses Web Crypto so the same code runs in the Edge
 * middleware and in Node route handlers.
 */

export const GATE_COOKIE = "scansite_session";
export const SESSION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function adminPassword() {
  return process.env.SCANSITE_ADMIN_PASSWORD || process.env.SCANSITE_GATE_PASSWORD || "";
}

export function adminUsername() {
  return process.env.SCANSITE_ADMIN_USER || "admin";
}

/** Authentication is mandatory: configured = a password exists to check against. */
export function adminConfigured() {
  return Boolean(adminPassword());
}

async function hmacHex(key, data) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Constant-time check of submitted credentials against the configured admin. */
export async function verifyLogin(username, password) {
  const configuredPass = adminPassword();
  if (!configuredPass) return false;

  const okUser = safeEqual(
    await hmacHex("scansite-admin", String(username ?? "")),
    await hmacHex("scansite-admin", adminUsername()),
  );
  const okPass = safeEqual(
    await hmacHex("scansite-admin", String(password ?? "")),
    await hmacHex("scansite-admin", configuredPass),
  );
  return okUser && okPass;
}

/** Value for the session cookie. */
export async function createSession() {
  const exp = Date.now() + SESSION_MS;
  const sig = await hmacHex(adminPassword(), String(exp));
  return `${exp}.${sig}`;
}

/** True when the cookie is present, unexpired, and correctly signed. */
export async function verifySession(value) {
  const key = adminPassword();
  if (!key || !value) return false;
  const [expStr, sig] = String(value).split(".");
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = await hmacHex(key, expStr);
  return safeEqual(expected, sig ?? "");
}
