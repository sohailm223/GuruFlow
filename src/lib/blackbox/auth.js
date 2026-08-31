/**
 * Collector authentication.
 *
 * Every collector request MUST carry a valid HMAC request signature — signing is
 * not optional. Required headers:
 *
 *   X-ScanSite-Site:      site_8c72fa
 *   X-ScanSite-Key:       sk_bb_…            (compared as SHA-256 hash, constant-time)
 *   X-ScanSite-Timestamp: 1756300000         (must be within MAX_SKEW_MS)
 *   X-ScanSite-Nonce:     32-hex random      (single-use within the skew window)
 *   X-ScanSite-Signature: sha256=HMAC(key, timestamp + "." + nonce + "." + body)
 *
 * Only the SHA-256 hash of a collector key is stored, so a leak of the data
 * directory does not leak usable credentials. All comparisons are constant-time.
 */

import crypto from "crypto";
import { getSiteById, getConnection } from "./storage";

/** Must stay byte-identical to connection.hashSecret. */
function hashSecret(secret) {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

export const HEADERS = {
  site: "x-scansite-site",
  key: "x-scansite-key",
  timestamp: "x-scansite-timestamp",
  nonce: "x-scansite-nonce",
  signature: "x-scansite-signature",
};

/** Reject signed requests whose timestamp is outside this window. */
export const MAX_SKEW_MS = 5 * 60_000;

export const AUTH_ERRORS = {
  missing: { status: 401, error: "Missing collector credentials" },
  unknownSite: { status: 401, error: "Unknown site" },
  badKey: { status: 401, error: "Invalid collector credentials" },
  disabled: { status: 403, error: "Website connection disabled" },
  missingSignature: { status: 401, error: "Invalid collector credentials" },
  badSignature: { status: 401, error: "Invalid collector credentials" },
  staleTimestamp: { status: 401, error: "Request timestamp outside allowed window" },
  replayedNonce: { status: 401, error: "Request nonce already used" },
};

/** Deliberately identical message for every credential failure. */
function fail(kind) {
  return { ok: false, ...AUTH_ERRORS[kind] };
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a ?? ""));
  const bb = Buffer.from(String(b ?? ""));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/* ------------------------------------------------------------------ *
 * Nonce replay protection
 * ------------------------------------------------------------------ */

/**
 * Single-use nonces seen within the skew window, nonce -> expiry ms.
 * In-memory on purpose: replay protection only needs to outlive the timestamp
 * window, and a restart merely resets a 5-minute anti-replay cache. A
 * multi-instance deployment would swap this for a shared store.
 */
const seenNonces = new Map();

function pruneNonces(now) {
  for (const [nonce, exp] of seenNonces) {
    if (exp <= now) seenNonces.delete(nonce);
  }
}

/** True the FIRST time a nonce is seen within the window; false on replay. */
function rememberNonce(nonce, now) {
  pruneNonces(now);
  if (seenNonces.has(nonce)) return false;
  seenNonces.set(nonce, now + MAX_SKEW_MS);
  return true;
}

/**
 * Authenticate a collector request. Signature, timestamp and nonce are REQUIRED.
 *
 * @param {Request} req
 * @param {string}  rawBody  needed for signature verification
 * @returns {Promise<{ok:true, site, connection} | {ok:false, status, error}>}
 */
export async function authenticateCollector(req, rawBody) {
  const siteId = req.headers.get(HEADERS.site);
  const key = req.headers.get(HEADERS.key);

  if (!siteId || !key) return fail("missing");

  const site = await getSiteById(siteId);
  if (!site) return fail("unknownSite");

  // Checked before the key: a deliberately disconnected site must report 403,
  // not a credential error, even though its key has been revoked.
  if (site.connectionStatus === "disconnected") return fail("disabled");

  const connection = await getConnection(siteId);
  if (!connection?.keyHash) return fail("badKey");

  // Never reveal which half of the credential was wrong.
  if (!safeEqual(connection.keyHash, hashSecret(key))) return fail("badKey");

  // Signature is mandatory from here on.
  const signature = req.headers.get(HEADERS.signature);
  const timestamp = req.headers.get(HEADERS.timestamp);
  const nonce = req.headers.get(HEADERS.nonce);
  if (!signature || !timestamp || !nonce) return fail("missingSignature");

  const signed = verifySignature({ signature, timestamp, nonce, rawBody, key });
  if (!signed.ok) return fail(signed.reason);

  return { ok: true, site, connection };
}

/**
 * Isolated signing check: timestamp freshness, nonce single-use, then a
 * constant-time HMAC comparison over `${timestamp}.${nonce}.${body}`.
 */
export function verifySignature({ signature, timestamp, nonce, rawBody, key }) {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: "badSignature" };

  const now = Date.now();
  const skew = Math.abs(now - ts * (ts < 1e12 ? 1000 : 1));
  if (skew > MAX_SKEW_MS) return { ok: false, reason: "staleTimestamp" };

  if (typeof nonce !== "string" || nonce.length < 16) return { ok: false, reason: "badSignature" };
  if (!rememberNonce(nonce, now)) return { ok: false, reason: "replayedNonce" };

  const expected = `sha256=${crypto
    .createHmac("sha256", key)
    .update(`${timestamp}.${nonce}.${rawBody ?? ""}`)
    .digest("hex")}`;

  if (!safeEqual(expected, signature)) return { ok: false, reason: "badSignature" };
  return { ok: true };
}

/** Helper for the WordPress side / tests: build the full signed header set. */
export function signRequest({ site, key, rawBody, timestamp = Math.floor(Date.now() / 1000), nonce = crypto.randomBytes(16).toString("hex") }) {
  return {
    [HEADERS.site]: site,
    [HEADERS.key]: key,
    [HEADERS.timestamp]: String(timestamp),
    [HEADERS.nonce]: nonce,
    [HEADERS.signature]: `sha256=${crypto
      .createHmac("sha256", key)
      .update(`${timestamp}.${nonce}.${rawBody}`)
      .digest("hex")}`,
  };
}

/**
 * Lightweight local user for UI that wants an actor. Authentication for the
 * dashboard itself is handled by gate.js (mandatory local admin).
 */
export const localUser = {
  id: "local-admin",
  name: "Administrator",
  role: "admin",
};
