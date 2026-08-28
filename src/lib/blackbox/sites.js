/**
 * Site records: creation, normalisation, and derived connection status.
 */

import crypto from "crypto";

export const ENVIRONMENTS = ["production", "staging", "development"];

export function newSiteId() {
  return `site_${crypto.randomBytes(3).toString("hex")}`;
}

/**
 * Normalise a user-supplied website URL:
 *  - lowercase host
 *  - strip path/query/fragment
 *  - remove trailing slash
 *  - keep the scheme the user gave, defaulting to https
 */
export function normalizeSiteUrl(input) {
  if (typeof input !== "string") return null;

  let raw = input.trim();
  if (!raw) return null;

  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw)) raw = `https://${raw}`;

  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const host = url.hostname.toLowerCase();
  if (!host || !host.includes(".")) return null;

  const port = url.port ? `:${url.port}` : "";
  return `${url.protocol}//${host}${port}`;
}

/** "https://copperskyhearing.com" -> "copperskyhearing.com" */
export function siteHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function createSiteRecord({ name, url, environment = "production" }) {
  const now = Date.now();
  return {
    id: newSiteId(),
    name: String(name).trim(),
    url,
    host: siteHost(url),
    platform: "wordpress",
    environment: ENVIRONMENTS.includes(environment) ? environment : "production",
    connectionStatus: "pending", // pending | connected | disconnected
    monitoringStatus: "inactive", // inactive | active
    createdAt: now,
    connectedAt: null,
    disconnectedAt: null,
    lastSeenAt: null,
    lastEventAt: null,
    lastErrorAt: null,
    lastError: null,
    collectorVersion: null,
    wordpress: null,
    capability: null,
  };
}

/* ------------------------------------------------------------------ *
 * Derived connection status
 * ------------------------------------------------------------------ */

const FRESH_MS = 10 * 60_000; // < 10 min  -> connected
const STALE_MS = 30 * 60_000; // 10–30 min -> connection issue

/**
 * Never flips to "disconnected" the instant a heartbeat is missed — WP-Cron
 * is unreliable, so a site is only down after 30 minutes of silence.
 */
export function connectionHealth(site, now = Date.now()) {
  if (!site || site.connectionStatus !== "connected") {
    return {
      key: site?.connectionStatus === "disconnected" ? "disconnected" : "never",
      label: site?.connectionStatus === "disconnected" ? "Disconnected" : "Pending",
      tone: site?.connectionStatus === "disconnected" ? "neutral" : "pending",
      since: site?.lastSeenAt ?? null,
    };
  }

  if (!site.lastSeenAt) {
    return { key: "pending", label: "Pending", tone: "pending", since: null };
  }

  const age = now - site.lastSeenAt;

  if (age < FRESH_MS) {
    return { key: "connected", label: "Connected", tone: "ok", since: site.lastSeenAt };
  }
  if (age < STALE_MS) {
    return {
      key: "issue",
      label: "Connection Issue",
      tone: "warn",
      since: site.lastSeenAt,
    };
  }
  return {
    key: "disconnected",
    label: "Disconnected",
    tone: "bad",
    since: site.lastSeenAt,
  };
}

/** Clock accessor kept out of component bodies for react-hooks/purity. */
export function nowMs() {
  return Date.now();
}

export function timeAgo(ms, now = Date.now()) {
  if (!ms) return "never";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s} sec ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}
