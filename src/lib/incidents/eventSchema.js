/**
 * Black Box event schema.
 *
 * An "event" is a single observed change on a WordPress site. Collectors
 * (the WP plugin / cron / file watcher) POST batches of these to
 * /api/blackbox/ingest. The correlation engine turns them into incidents.
 *
 * Everything is intentionally plain JSON so a PHP collector can emit it
 * without a schema library.
 */

export const CATEGORIES = [
  "core", // WordPress core
  "plugin", // plugins
  "theme", // themes
  "file", // files
  "db", // DB
  "user", // users / roles
  "cron", // WP-Cron
  "config", // .htaccess + wp-config.php
  "dns", // DNS records
  "ssl", // SSL certificate
  "smtp", // SMTP / mail settings
  "redirect", // redirects
  "auth", // admin logins
];

export const EVENT_TYPES = [
  "plugin.updated",
  "plugin.installed",
  "plugin.activated",
  "plugin.deactivated",
  "plugin.deleted",
  "theme.updated",
  "theme.installed",
  "theme.activated",
  "core.updated",
  "files.changed",
  "file.created",
  "file.modified",
  "file.deleted",
  "db.option_changed",
  "db.table_changed",
  "user.created",
  "user.role_changed",
  "user.deleted",
  "cron.created",
  "cron.deleted",
  "htaccess.modified",
  "wpconfig.modified",
  "dns.record_changed",
  "ssl.expiring",
  "ssl.renewed",
  "ssl.invalid",
  "smtp.settings_changed",
  "redirect.added",
  "redirect.removed",
  "admin_login.success",
  "admin_login.failed",
  "site.error_burst",
  "site.status_changed",
];

const MAX_BATCH = 1000;

/**
 * Validate + normalise one raw event. Returns { ok, event } or { ok:false, error }.
 */
export function normalizeEvent(raw, fallback = {}) {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "event must be an object" };
  }

  const type = typeof raw.type === "string" ? raw.type.trim() : "";
  if (!type) return { ok: false, error: "event.type is required" };
  if (!EVENT_TYPES.includes(type)) {
    return { ok: false, error: `unknown event.type "${type}"` };
  }

  const category =
    typeof raw.category === "string" && CATEGORIES.includes(raw.category)
      ? raw.category
      : categoryForType(type);

  const atMs = toMillis(raw.at ?? fallback.at ?? Date.now());
  if (atMs === null) return { ok: false, error: "event.at is not a valid time" };

  const event = {
    id: typeof raw.id === "string" && raw.id ? raw.id : null,
    type,
    category,
    at: atMs,
    actor: pickActor(raw),
    target: typeof raw.target === "string" ? raw.target : undefined,
    path: typeof raw.path === "string" ? raw.path : undefined,
    from: raw.from ?? undefined,
    to: raw.to ?? undefined,
    count: Number.isFinite(raw.count) ? Math.max(0, Math.floor(raw.count)) : undefined,
    sourceIp: typeof raw.sourceIp === "string" ? raw.sourceIp : undefined,
    userAgent: typeof raw.userAgent === "string" ? raw.userAgent : undefined,
    meta: raw.meta && typeof raw.meta === "object" ? raw.meta : {},
  };

  return { ok: true, event };
}

/** Validate a whole ingest payload. */
export function normalizeBatch(payload) {
  if (!payload || typeof payload !== "object") {
    return { ok: false, error: "body must be a JSON object" };
  }

  const site =
    typeof payload.site === "string" && payload.site.trim()
      ? payload.site.trim()
      : null;
  if (!site) return { ok: false, error: "site is required" };

  if (!Array.isArray(payload.events)) {
    return { ok: false, error: "events must be an array" };
  }
  if (payload.events.length === 0) {
    return { ok: false, error: "events must not be empty" };
  }
  if (payload.events.length > MAX_BATCH) {
    return { ok: false, error: `max ${MAX_BATCH} events per request` };
  }

  const events = [];
  const rejected = [];

  payload.events.forEach((raw, i) => {
    const result = normalizeEvent(raw, { site });
    if (result.ok) events.push({ ...result.event, site });
    else rejected.push({ index: i, error: result.error });
  });

  if (events.length === 0) {
    return { ok: false, error: "no valid events", rejected };
  }

  events.sort((a, b) => a.at - b.at);

  return {
    ok: true,
    site,
    events,
    rejected,
    receivedAt: Date.now(),
  };
}

/* ---------------- helpers ---------------- */

function pickActor(raw) {
  const a = raw.actor;
  if (!a) return undefined;
  if (typeof a === "string") return { name: a };
  if (typeof a === "object") {
    return {
      name: a.name ?? undefined,
      role: a.role ?? undefined,
      ip: a.ip ?? undefined,
    };
  }
  return undefined;
}

function toMillis(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const t = Date.parse(value);
    if (!Number.isNaN(t)) return t;
  }
  return null;
}

/** Map an event type to its monitoring category. */
export function categoryForType(type) {
  const map = {
    plugin: "plugin",
    theme: "theme",
    core: "core",
    file: "file",
    files: "file",
    db: "db",
    user: "user",
    cron: "cron",
    htaccess: "config",
    wpconfig: "config",
    dns: "dns",
    ssl: "ssl",
    smtp: "smtp",
    redirect: "redirect",
    admin_login: "auth",
    site: "core",
  };
  const head = type.split(".")[0];
  return map[head] ?? "file";
}
