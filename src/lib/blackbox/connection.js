/**
 * Connection pairing + collector credentials.
 *
 * Two distinct secrets, never conflated:
 *
 *  1. connectionCode  short, human-readable, single-use, expires in 30 min.
 *                     Typed into the WordPress plugin by a human.
 *  2. collectorKey    long, random, permanent. Returned exactly once from
 *                     /api/blackbox/connect and stored by WordPress.
 *                     Only its SHA-256 hash is kept server-side.
 *
 * The pairing code is marked used the moment it is redeemed, so it cannot be
 * replayed, and it is never valid for event delivery.
 */

import crypto from "crypto";
import {
  saveConnection,
  getConnection,
  getConnectionByCode,
} from "./storage";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1 — readable
export const CODE_TTL_MS = 30 * 60_000;

/** "K8F3-PQ9X" */
export function generateConnectionCode() {
  const bytes = crypto.randomBytes(8);
  const chars = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}`;
}

/** 256-bit collector secret, returned to WordPress once and never again. */
export function generateCollectorKey() {
  return `sk_bb_${crypto.randomBytes(32).toString("hex")}`;
}

export function hashSecret(secret) {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

/**
 * Placeholder for the admin UI. Deliberately reveals no part of the secret —
 * not even the prefix. The fingerprint (a slice of the key's SHA-256) is what
 * an operator compares against, and it cannot be reversed into the key.
 */
export function displayKey() {
  return "••••••••••••••••";
}

/** Non-reversible confirmation handle for a collector key. */
export function keyFingerprint(collectorKey) {
  if (!collectorKey) return null;
  return hashSecret(collectorKey).slice(0, 8);
}

/**
 * Issue a fresh pairing code for a site, replacing any previous one.
 */
export async function issueConnectionCode(siteId, { ttlMs = CODE_TTL_MS } = {}) {
  const now = Date.now();
  const code = generateConnectionCode();

  // A fresh code supersedes any previous one and revokes the old secret, so
  // those fields are named explicitly rather than left as stale values.
  await saveConnection(siteId, {
    code,
    codeUsed: false,
    codeCreatedAt: now,
    codeExpiresAt: now + ttlMs,
    keyHash: null,
    keyDisplay: null,
    keyFingerprint: null,
    keyCreatedAt: null,
    keyRotatedAt: null,
    connectedAt: null,
    rotatedCount: 0,
  });

  return {
    code,
    siteId,
    expiresAt: now + ttlMs,
    expiresInMinutes: Math.round(ttlMs / 60_000),
  };
}

export const CODE_ERRORS = {
  NOT_FOUND: { status: 400, error: "Invalid or expired connection code" },
  USED: { status: 400, error: "This connection code has already been used" },
  EXPIRED: { status: 400, error: "Invalid or expired connection code" },
};

/**
 * Redeem a pairing code. Marks it used whether or not the rest succeeds,
 * so a failed attempt cannot be retried with the same code.
 */
export async function redeemConnectionCode({ code, siteUrl, wordpress }) {
  if (typeof code !== "string" || !code.trim()) return { ok: false, ...CODE_ERRORS.NOT_FOUND };

  const normalized = code.trim().toUpperCase();
  const conn = await getConnectionByCode(normalized);
  if (!conn) return { ok: false, ...CODE_ERRORS.NOT_FOUND };

  if (conn.codeUsed) return { ok: false, ...CODE_ERRORS.USED };
  if (conn.codeExpiresAt && Date.now() > conn.codeExpiresAt) {
    await saveConnection(conn.siteId, { codeUsed: true, codeUsedAt: Date.now() });
    return { ok: false, ...CODE_ERRORS.EXPIRED };
  }

  // Mark used first — single-use even if the caller then fails.
  await saveConnection(conn.siteId, { codeUsed: true, codeUsedAt: Date.now() });

  const collectorKey = generateCollectorKey();
  const now = Date.now();

  await saveConnection(conn.siteId, {
    keyHash: hashSecret(collectorKey),
    keyDisplay: displayKey(),
    keyFingerprint: keyFingerprint(collectorKey),
    keyCreatedAt: now,
    connectedAt: now,
    siteUrl,
    wordpress: wordpress ?? null,
  });

  return { ok: true, siteId: conn.siteId, collectorKey, connectedAt: now };
}

/**
 * Ask the WordPress side to rotate its collector key.
 *
 * ScanSite never generates or stores the raw secret. Instead this flags the
 * connection; the next heartbeat returns `command.rotateKey`, the plugin
 * generates a fresh key locally, and pushes only its hash target back via
 * /api/blackbox/rotate (authenticated with the current key). The raw key is
 * therefore created and stored only in WordPress and never displayed.
 */
export async function requestKeyRotation(siteId) {
  const conn = await getConnection(siteId);
  if (!conn) return { ok: false, status: 404, error: "Website not found" };
  await saveConnection(siteId, { pendingRotate: true, rotationRequestedAt: Date.now() });
  return { ok: true, siteId };
}

/** Validate and accept a WordPress-generated replacement key (hash-only). */
export async function acceptKeyRotation(siteId, newKey) {
  if (typeof newKey !== "string" || !/^sk_bb_[0-9a-f]{64}$/.test(newKey)) {
    return { ok: false, status: 400, error: "Invalid collector key format" };
  }
  const conn = await getConnection(siteId);
  if (!conn) return { ok: false, status: 404, error: "Website not found" };

  const now = Date.now();
  await saveConnection(siteId, {
    keyHash: hashSecret(newKey),
    keyDisplay: displayKey(),
    keyFingerprint: keyFingerprint(newKey),
    keyCreatedAt: now,
    keyRotatedAt: now,
    rotatedCount: (conn.rotatedCount ?? 0) + 1,
    pendingRotate: false,
  });
  return { ok: true, siteId, rotatedAt: now };
}

/**
 * Invalidate the permanent secret (disconnect). Existing incidents stay.
 */
export async function revokeCollectorKey(siteId) {
  const conn = await getConnection(siteId);
  if (!conn) return { ok: false };

  await saveConnection(siteId, {
    keyHash: null,
    keyDisplay: null,
    keyFingerprint: null,
    keyCreatedAt: null,
    revokedAt: Date.now(),
  });

  return { ok: true };
}

/**
 * Redacted view — safe to send to the browser. Never includes a usable key.
 */
export function publicConnection(conn) {
  if (!conn) return null;
  return {
    siteId: conn.siteId,
    paired: Boolean(conn.keyHash),
    keyDisplay: conn.keyDisplay ?? null,
    keyFingerprint: conn.keyFingerprint ?? null,
    connectedAt: conn.connectedAt ?? null,
    keyRotatedAt: conn.keyRotatedAt ?? null,
    rotatedCount: conn.rotatedCount ?? 0,
    rotationPending: Boolean(conn.pendingRotate),
    pendingCode:
      conn.code && !conn.codeUsed && conn.codeExpiresAt > Date.now()
        ? { code: conn.code, expiresAt: conn.codeExpiresAt }
        : null,
  };
}
