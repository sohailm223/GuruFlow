/**
 * Outbound HTTP guard for website verification.
 *
 * Verification is the ONE place ScanSite makes an outbound request: a single GET
 * of a monitored site's own registered origin, to report its HTTP status. That
 * is exactly the shape of request an attacker would like to borrow (SSRF), so
 * the rules live here, in one place, and are unit-testable.
 *
 * Rules
 *   1. The URL is never taken from the request body — only the site's stored,
 *      canonicalised origin is used, reduced to scheme + host + port.
 *   2. http and https only. No file:, gopher:, data:, dict:, ftp:, unix:.
 *   3. Blocked outright, in every environment:
 *        link-local 169.254.0.0/16 and fe80::/10 (includes 169.254.169.254,
 *        the cloud metadata endpoint), CGNAT 100.64.0.0/10, 0.0.0.0/::,
 *        multicast, and reserved ranges.
 *   4. Blocked unless the local-development escape hatch is on:
 *        loopback (127.0.0.0/8, ::1, "localhost", "*.localhost") and private
 *        ranges (10/8, 172.16/12, 192.168/16, fc00::/7).
 *      The hatch is the explicit env var SCANSITE_ALLOW_LOCAL_VERIFY=1 — it is
 *      NOT implied by NODE_ENV=development, and it never unlocks link-local or
 *      CGNAT.
 *   5. Hostnames are resolved and EVERY returned address is checked, both
 *      before connecting and again inside the socket's own lookup hook, so a
 *      DNS answer that changes between the two (rebinding) cannot slip through.
 *   6. Redirects are validated before being followed, up to MAX_REDIRECTS, and
 *      a redirect into a blocked range stops the request.
 *   7. Short timeout, response body never read or returned — only the status
 *      code leaves this module.
 */

import dns from "node:dns";
import http from "node:http";
import https from "node:https";

export const VERIFY_TIMEOUT_MS = 6_000;
export const MAX_REDIRECTS = 3;
/** Upper bound; the body is destroyed unread, so this is a ceiling not a buffer. */
export const MAX_RESPONSE_BYTES = 64 * 1024;

export const BLOCKED_REASON = {
  LOCAL: "local addresses are blocked outside local development",
  LINK_LOCAL: "link-local and metadata addresses are always blocked",
  CGNAT: "carrier-grade NAT space is always blocked",
  UNSPECIFIED: "unspecified addresses are blocked",
  MULTICAST: "multicast addresses are blocked",
  RESERVED: "reserved addresses are blocked",
  SCHEME: "only http and https are allowed",
  HOST: "a host name is required",
};

/** Explicit opt-in for loopback/private targets during local development. */
export function localVerifyAllowed() {
  return process.env.SCANSITE_ALLOW_LOCAL_VERIFY === "1";
}

/* ---------------------------------------------------------------- addresses */

function ipv4ToInt(ip) {
  return ip.split(".").reduce((acc, part) => acc * 256 + Number(part), 0);
}

function inRange(ip, cidr) {
  const [base, bits] = cidr.split("/");
  const mask = bits === "0" ? 0 : (0xffffffff << (32 - Number(bits))) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

/** Strip an IPv4-mapped IPv6 prefix so ::ffff:127.0.0.1 is judged as IPv4. */
function normalizeIp(ip) {
  const lower = String(ip).toLowerCase();
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? mapped[1] : lower;
}

const V4_PRIVATE = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"];
const V4_LINK_LOCAL = ["169.254.0.0/16"];
const V4_CGNAT = ["100.64.0.0/10"];
const V4_RESERVED = ["240.0.0.0/4", "192.0.0.0/29", "198.18.0.0/15", "192.0.2.0/24", "198.51.100.0/24", "203.0.113.0/24"];

/**
 * Classify one IP literal.
 * @returns {{ok: boolean, kind: string, reason?: string}}
 */
export function addressAllowed(ip) {
  const addr = normalizeIp(ip);

  if (/^\d+\.\d+\.\d+\.\d+$/.test(addr)) {
    if (inRange(addr, "127.0.0.0/8")) {
      return localVerifyAllowed() ? { ok: true, kind: "loopback" } : { ok: false, kind: "loopback", reason: BLOCKED_REASON.LOCAL };
    }
    if (V4_LINK_LOCAL.some((r) => inRange(addr, r))) return { ok: false, kind: "link_local", reason: BLOCKED_REASON.LINK_LOCAL };
    if (V4_CGNAT.some((r) => inRange(addr, r))) return { ok: false, kind: "cgnat", reason: BLOCKED_REASON.CGNAT };
    if (addr === "0.0.0.0" || addr === "255.255.255.255") return { ok: false, kind: "unspecified", reason: BLOCKED_REASON.UNSPECIFIED };
    if (inRange(addr, "224.0.0.0/4")) return { ok: false, kind: "multicast", reason: BLOCKED_REASON.MULTICAST };
    if (V4_PRIVATE.some((r) => inRange(addr, r))) {
      return localVerifyAllowed() ? { ok: true, kind: "private" } : { ok: false, kind: "private", reason: BLOCKED_REASON.LOCAL };
    }
    if (V4_RESERVED.some((r) => inRange(addr, r))) return { ok: false, kind: "reserved", reason: BLOCKED_REASON.RESERVED };
    return { ok: true, kind: "public" };
  }

  // IPv6
  const v6 = addr.includes("%") ? addr.split("%")[0] : addr;
  if (v6 === "::1") return localVerifyAllowed() ? { ok: true, kind: "loopback" } : { ok: false, kind: "loopback", reason: BLOCKED_REASON.LOCAL };
  if (v6 === "::") return { ok: false, kind: "unspecified", reason: BLOCKED_REASON.UNSPECIFIED };
  if (/^fe[89ab]/.test(v6)) return { ok: false, kind: "link_local", reason: BLOCKED_REASON.LINK_LOCAL };
  if (/^f[cd]/.test(v6)) {
    return localVerifyAllowed() ? { ok: true, kind: "private" } : { ok: false, kind: "private", reason: BLOCKED_REASON.LOCAL };
  }
  if (/^ff/.test(v6)) return { ok: false, kind: "multicast", reason: BLOCKED_REASON.MULTICAST };
  return { ok: true, kind: "public" };
}

const BLOCKED_HOSTS = [".local", ".internal", ".lan", ".home", ".corp"];

/** Is this an IP literal? (Deliberately conservative: anything else is a name.) */
function isIpLiteral(host) {
  return /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":");
}

/**
 * Validate a URL string without touching the network.
 * @returns {{ok: boolean, url?: URL, reason?: string, kind?: string}}
 */
export function guardTarget(input) {
  let url;
  try {
    url = new URL(String(input));
  } catch {
    return { ok: false, reason: "not a valid URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: BLOCKED_REASON.SCHEME };
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) return { ok: false, reason: BLOCKED_REASON.HOST };

  if (!isIpLiteral(host)) {
    if (host === "localhost" || host.endsWith(".localhost")) {
      return localVerifyAllowed()
        ? { ok: true, url, kind: "loopback" }
        : { ok: false, reason: BLOCKED_REASON.LOCAL, kind: "loopback" };
    }
    if (BLOCKED_HOSTS.some((suffix) => host.endsWith(suffix))) {
      return { ok: false, reason: BLOCKED_REASON.LINK_LOCAL, kind: "internal_name" };
    }
    return { ok: true, url, kind: "hostname" };
  }

  const verdict = addressAllowed(host);
  return verdict.ok ? { ok: true, url, kind: verdict.kind } : { ok: false, reason: verdict.reason, kind: verdict.kind };
}

/**
 * Resolve a host name and check every address returned.
 * @returns {Promise<{ok: boolean, addresses?: string[], reason?: string}>}
 */
export function resolveAndGuard(hostname, port = 443) {
  return new Promise((resolve) => {
    dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err) return resolve({ ok: false, reason: `DNS lookup failed (${err.code ?? err.message})` });
      const list = addresses ?? [];
      if (!list.length) return resolve({ ok: false, reason: "DNS returned no addresses" });
      for (const a of list) {
        const verdict = addressAllowed(a.address);
        if (!verdict.ok) return resolve({ ok: false, reason: `${a.address}: ${verdict.reason}` });
      }
      resolve({ ok: true, addresses: list.map((a) => a.address), port });
    });
  });
}

/**
 * Socket-level lookup hook: re-checks every address at connect time, so a DNS
 * answer that changes after the pre-flight check cannot reach a blocked host.
 */
export function guardedLookup(hostname, options, callback) {
  const wantAll = Boolean(options?.all);
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = addresses ?? [];
    const bad = list.find((a) => !addressAllowed(a.address).ok);
    if (bad || !list.length) {
      const error = new Error(`blocked or empty DNS result for ${hostname}`);
      error.code = "ESCANSSITE_BLOCKED";
      return callback(error);
    }
    if (wantAll) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

/**
 * Fetch ONLY the HTTP status of a registered site origin.
 *
 * The response body is never read, never buffered and never returned. Redirects
 * are validated before being followed; a redirect into a blocked range ends the
 * request and is reported instead.
 *
 * @returns {Promise<{ok: boolean, status?: number, error?: string, blocked?: string, redirects?: number, finalUrl?: string}>}
 */
export async function probeStatus(input, { redirects = 0 } = {}) {
  const guard = guardTarget(input);
  if (!guard.ok) return { ok: false, blocked: guard.reason, kind: guard.kind };

  const url = guard.url;

  if (guard.kind === "hostname") {
    const resolved = await resolveAndGuard(url.hostname, url.port || (url.protocol === "https:" ? 443 : 80));
    if (!resolved.ok) return { ok: false, blocked: resolved.reason };
  }

  const lib = url.protocol === "https:" ? https : http;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    let req;
    try {
      req = lib.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || (url.protocol === "https:" ? 443 : 80),
          path: `${url.pathname}${url.search}`,
          method: "GET",
          lookup: guardedLookup,
          timeout: VERIFY_TIMEOUT_MS,
          // A monitored site's own origin is fetched with its real Host header.
          headers: { "User-Agent": "ScanSite-Verify/1.0", Accept: "*/*" },
          ...(url.protocol === "https:" ? { servername: url.hostname } : {}),
        },
        (res) => {
          const status = res.statusCode ?? 0;
          // Never read the body.
          res.destroy();

          if (status >= 300 && status < 400 && res.headers.location) {
            if (redirects >= MAX_REDIRECTS) {
              return finish({ ok: status === 200, status, error: "too many redirects", redirects });
            }
            let next;
            try {
              next = new URL(res.headers.location, url).toString();
            } catch {
              return finish({ ok: false, status, error: "unparsable redirect target", redirects });
            }
            const nextGuard = guardTarget(next);
            if (!nextGuard.ok) {
              return finish({ ok: false, status, blocked: `redirect blocked: ${nextGuard.reason}`, redirects: redirects + 1 });
            }
            return probeStatus(next, { redirects: redirects + 1 }).then((r) => finish({ ...r, finalUrl: next }));
          }

          finish({ ok: status === 200, status, redirects });
        }
      );
    } catch (err) {
      return finish({ ok: false, error: err.message });
    }

    req.on("timeout", () => {
      req.destroy(new Error("timed out"));
    });
    req.on("error", (err) => {
      if (err.code === "ESCANSSITE_BLOCKED") return finish({ ok: false, blocked: err.message });
      finish({ ok: false, error: err.code === "ECONNABORTED" || /timed out/i.test(err.message) ? "timed out" : "unreachable" });
    });
    req.end();
  });
}

/**
 * The canonical origin ScanSite is allowed to verify for a site: scheme + host +
 * port only. Any path or query the site record carries is dropped, so a stored
 * URL cannot smuggle a request to an unrelated endpoint.
 */
export function canonicalOrigin(urlString) {
  try {
    const url = new URL(String(urlString));
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}
