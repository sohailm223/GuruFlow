/**
 * Optional shared-password gate for the whole dashboard.
 *
 * The MVP ships with no accounts (by design). For real deployments we still
 * need *some* wall in front of client data, so this provides a single shared
 * password via `SCANSITE_GATE_PASSWORD`. When unset, the gate is fully
 * disabled and behaviour is unchanged.
 *
 * Sessions are stateless HMAC cookies keyed by the gate password, so no store
 * or Redis is required. Uses Web Crypto so the same code runs in the Edge
 * middleware and in Node route handlers.
 */

export const GATE_COOKIE = "scansite_session";
export const SESSION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function gateEnabled() {
  return Boolean(process.env.SCANSITE_GATE_PASSWORD);
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

/** Value for the session cookie. */
export async function createSession() {
  const exp = Date.now() + SESSION_MS;
  const sig = await hmacHex(process.env.SCANSITE_GATE_PASSWORD, String(exp));
  return `${exp}.${sig}`;
}

/** True when the cookie is present, unexpired, and correctly signed. */
export async function verifySession(value) {
  if (!value) return false;
  const [expStr, sig] = value.split(".");
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = await hmacHex(process.env.SCANSITE_GATE_PASSWORD, expStr);
  return safeEqual(expected, sig ?? "");
}

/** Constant-time compare of a submitted password against the configured one. */
export async function checkPassword(candidate) {
  const configured = process.env.SCANSITE_GATE_PASSWORD;
  if (!configured) return false;
  const a = await hmacHex("scansite-gate", String(candidate ?? ""));
  const b = await hmacHex("scansite-gate", configured);
  return safeEqual(a, b);
}
