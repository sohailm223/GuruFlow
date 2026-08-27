/**
 * Collector authentication.
 *
 * MVP: per-site API key, sent as headers (never in the query string):
 *
 *   X-ScanSite-Site: site_8c72fa
 *   X-ScanSite-Key:  sk_bb_…
 *
 * The signing layer below is deliberately isolated so HMAC request signing can
 * be turned on later without touching any route:
 *
 *   X-ScanSite-Timestamp: 1756300000
 *   X-ScanSite-Signature: sha256=HMAC(timestamp + "." + rawBody, collectorKey)
 *
 * Only the SHA-256 hash of a collector key is stored, so a leak of the data
 * directory does not leak usable credentials. Comparison is constant-time.
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
  signature: "x-scansite-signature",
};

/** Reject signed requests whose timestamp is outside this window. */
export const MAX_SKEW_MS = 5 * 60_000;

export const AUTH_ERRORS = {
  missing: { status: 401, error: "Missing collector credentials" },
  unknownSite: { status: 401, error: "Unknown site" },
  badKey: { status: 401, error: "Invalid collector credentials" },
  disabled: { status: 403, error: "Website connection disabled" },
  badSignature: { status: 401, error: "Invalid collector credentials" },
  staleTimestamp: { status: 401, error: "Request timestamp outside allowed window" },
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

/**
 * Authenticate a collector request.
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

  const signature = req.headers.get(HEADERS.signature);
  if (signature) {
    const signed = verifySignature({
      signature,
      timestamp: req.headers.get(HEADERS.timestamp),
      rawBody,
      key,
    });
    if (!signed.ok) return fail(signed.reason);
  }

  return { ok: true, site, connection };
}

/**
 * Isolated signing check. Kept separate so enabling HMAC later is a matter of
 * the collector sending the two extra headers — no route changes required.
 */
export function verifySignature({ signature, timestamp, rawBody, key }) {
  if (!timestamp) return { ok: false, reason: "badSignature" };

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: "badSignature" };

  const skew = Math.abs(Date.now() - ts * (ts < 1e12 ? 1000 : 1));
  if (skew > MAX_SKEW_MS) return { ok: false, reason: "staleTimestamp" };

  const expected = `sha256=${crypto
    .createHmac("sha256", key)
    .update(`${timestamp}.${rawBody ?? ""}`)
    .digest("hex")}`;

  if (!safeEqual(expected, signature)) return { ok: false, reason: "badSignature" };
  return { ok: true };
}

/** Helper for the WordPress side / tests: build the signature headers. */
export function signRequest({ key, rawBody, timestamp = Math.floor(Date.now() / 1000) }) {
  return {
    [HEADERS.timestamp]: String(timestamp),
    [HEADERS.signature]: `sha256=${crypto
      .createHmac("sha256", key)
      .update(`${timestamp}.${rawBody}`)
      .digest("hex")}`,
  };
}

/**
 * Lightweight local user for UI that wants an actor. No auth provider —
 * dashboard access does not require login in this MVP.
 */
export const localUser = {
  id: "local-admin",
  name: "Administrator",
  role: "admin",
};
