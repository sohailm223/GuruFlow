/**
 * Event schema + payload normalisation.
 *
 * The collector sends its own vocabulary; ScanSite normalises it into one
 * internal shape before anything else touches it. Collector-supplied
 * `severityHint` is recorded but never trusted — the analysis engine decides
 * the final risk.
 */

export const CATEGORIES = [
  "core",
  "plugin",
  "theme",
  "file",
  "db",
  "user",
  "cron",
  "config",
  "dns",
  "ssl",
  "smtp",
  "redirect",
  "auth",
];

export const CATEGORY_LABELS = {
  core: "WordPress core",
  plugin: "Plugins",
  theme: "Themes",
  file: "Files",
  db: "Database settings",
  user: "WordPress users",
  cron: "Cron jobs",
  config: "Configuration",
  dns: "DNS",
  ssl: "SSL",
  smtp: "SMTP",
  redirect: "Redirects",
  auth: "Authentication",
};

/**
 * Areas the WordPress collector cannot reliably observe from inside
 * WordPress. Kept in the schema so server-side checks can fill them later —
 * never faked in the meantime.
 */
export const NOT_MONITORED_BY_COLLECTOR = ["dns", "ssl"];

export const EVENT_TYPES = [
  // core
  "wordpress_updated",
  "core_file_modified",
  "core_integrity_failed",
  "site_error_burst",
  "site_status_changed",

  // plugin
  "plugin_installed",
  "plugin_activated",
  "plugin_deactivated",
  "plugin_updated",
  "plugin_deleted",

  // theme
  "theme_installed",
  "theme_activated",
  "theme_updated",
  "theme_deleted",

  // file
  "file_created",
  "file_modified",
  "file_deleted",
  "executable_created",
  "permission_changed",
  "files_changed",
  "file_integrity_mismatch",
  "unexpected_executable",
  "suspicious_code_detected",
  "core_file_mismatch",
  "plugin_file_mismatch",
  "theme_file_mismatch",
  "file_integrity_scan_completed",
  "file_integrity_scan_failed",
  "site_inventory",

  // db
  "option_changed",
  "siteurl_changed",
  "home_changed",
  "active_plugins_changed",
  "registration_setting_changed",
  "table_changed",

  // user
  "user_created",
  "user_deleted",
  "user_role_changed",
  "administrator_created",
  "password_reset",
  "users_snapshot",

  // auth
  "login_success",
  "login_failed",
  "login_failed_burst",
  "logout",
  "application_password_created",
  "application_password_deleted",

  // cron
  "cron_added",
  "cron_removed",
  "cron_modified",

  // config
  "wp_config_modified",
  "htaccess_modified",

  // redirect
  "redirect_created",
  "redirect_modified",
  "redirect_deleted",
  "unexpected_redirect",

  // smtp
  "smtp_setting_changed",
  "mail_failure",

  // external (server-side, not collector)
  "dns_record_changed",
  "ssl_expiring",
  "ssl_renewed",
  "ssl_invalid",

  // collector self-test
  "collector_test",
];

/**
 * Legacy dot-notation used by the first Black Box iteration, mapped forward so
 * old fixtures and the demo scenario keep working.
 */
const LEGACY_TYPE_ALIASES = {
  "plugin.updated": "plugin_updated",
  "plugin.installed": "plugin_installed",
  "plugin.activated": "plugin_activated",
  "plugin.deactivated": "plugin_deactivated",
  "plugin.deleted": "plugin_deleted",
  "theme.updated": "theme_updated",
  "theme.installed": "theme_installed",
  "theme.activated": "theme_activated",
  "core.updated": "wordpress_updated",
  "files.changed": "files_changed",
  "file.created": "file_created",
  "file.modified": "file_modified",
  "file.deleted": "file_deleted",
  "db.option_changed": "option_changed",
  "db.table_changed": "table_changed",
  "user.created": "user_created",
  "user.role_changed": "user_role_changed",
  "user.deleted": "user_deleted",
  "cron.created": "cron_added",
  "cron.deleted": "cron_removed",
  "htaccess.modified": "htaccess_modified",
  "wpconfig.modified": "wp_config_modified",
  "dns.record_changed": "dns_record_changed",
  "ssl.expiring": "ssl_expiring",
  "ssl.renewed": "ssl_renewed",
  "ssl.invalid": "ssl_invalid",
  "smtp.settings_changed": "smtp_setting_changed",
  "redirect.added": "redirect_created",
  "redirect.removed": "redirect_deleted",
  "admin_login.success": "login_success",
  "admin_login.failed": "login_failed",
  "site.error_burst": "site_error_burst",
  "site.status_changed": "site_status_changed",
};

export const SEVERITY_HINTS = ["info", "low", "medium", "high", "critical"];

const MAX_BATCH = 100;

export function resolveType(rawType) {
  if (typeof rawType !== "string") return null;
  const t = rawType.trim();
  return LEGACY_TYPE_ALIASES[t] ?? (EVENT_TYPES.includes(t) ? t : null);
}

export function categoryForType(type) {
  const head = String(type).split("_")[0];
  const map = {
    wordpress: "core",
    core: "core",
    site: "core",
    plugin: "plugin",
    theme: "theme",
    file: "file",
    files: "file",
    executable: "file",
    permission: "file",
    option: "db",
    siteurl: "db",
    home: "db",
    active: "db",
    registration: "db",
    table: "db",
    user: "user",
    administrator: "user",
    password: "user",
    login: "auth",
    logout: "auth",
    application: "auth",
    cron: "cron",
    wp: "config",
    htaccess: "config",
    redirect: "redirect",
    unexpected: "redirect",
    smtp: "smtp",
    mail: "smtp",
    dns: "dns",
    ssl: "ssl",
    collector: "core",
  };
  return map[head] ?? "file";
}

/* ------------------------------------------------------------------ *
 * Normalisation
 * ------------------------------------------------------------------ */

function toMillis(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === "string") {
    const t = Date.parse(value);
    if (!Number.isNaN(t)) return t;
  }
  return null;
}

function normalizeActor(actor) {
  if (!actor) return undefined;
  if (typeof actor === "string") return { username: actor };
  if (typeof actor !== "object") return undefined;
  return {
    userId: actor.userId ?? actor.id ?? undefined,
    username: actor.username ?? actor.name ?? undefined,
    role: actor.role ?? undefined,
    ip: actor.ip ?? undefined,
    // Carried through so the grouping engine can link same-session events.
    // Note the collector strips any key containing "session" before upload, so
    // in practice this only fills when a source sends it under this exact name.
    session: actor.session ?? actor.sessionId ?? undefined,
  };
}

function normalizeTarget(target) {
  if (!target) return undefined;
  if (typeof target === "string") return { name: capString(target) };
  if (typeof target !== "object") return undefined;
  return capValue(target, 1);
}

/* Input-shaping caps so a hostile collector can't bloat storage. */
const MAX_STR = 2000;
const MAX_DEPTH = 4;
const MAX_KEYS = 100;

function capString(s) {
  return typeof s === "string" && s.length > MAX_STR ? s.slice(0, MAX_STR) : s;
}

function capValue(v, depth) {
  if (depth > MAX_DEPTH) return null;
  if (typeof v === "string") return capString(v);
  if (Array.isArray(v)) return v.slice(0, MAX_KEYS).map((x) => capValue(x, depth + 1));
  if (v && typeof v === "object") {
    const out = {};
    let c = 0;
    for (const k of Object.keys(v)) {
      if (c++ >= MAX_KEYS) break;
      out[capString(k)] = capValue(v[k], depth + 1);
    }
    return out;
  }
  return v;
}

/** One raw collector event → internal event, or a rejection reason. */
export function normalizeEvent(raw, { siteId, receivedAt = Date.now() } = {}) {
  if (!raw || typeof raw !== "object") return { ok: false, error: "event must be an object" };

  const type = resolveType(raw.type);
  if (!type) return { ok: false, error: `unknown event.type "${raw.type}"` };

  const timestamp = toMillis(raw.timestamp ?? raw.at ?? receivedAt);
  if (timestamp === null) return { ok: false, error: "event.timestamp is not a valid time" };

  const category =
    typeof raw.category === "string" && CATEGORIES.includes(raw.category)
      ? raw.category
      : categoryForType(type);

  const changes =
    raw.changes && typeof raw.changes === "object"
      ? raw.changes
      : raw.from !== undefined || raw.to !== undefined
        ? { from: raw.from, to: raw.to }
        : undefined;

  return {
    ok: true,
    event: {
      eventId: typeof raw.eventId === "string" && raw.eventId ? raw.eventId : null,
      siteId: siteId ?? raw.site ?? raw.siteId ?? null,
      category,
      type,
      timestamp,
      severityHint: SEVERITY_HINTS.includes(raw.severityHint) ? raw.severityHint : null,
      actor: normalizeActor(raw.actor),
      target: normalizeTarget(raw.target ?? raw.path),
      changes,
      path: capString(typeof raw.path === "string" ? raw.path : raw.target?.path) ?? undefined,
      count: Number.isFinite(raw.count) ? Math.max(0, Math.floor(raw.count)) : undefined,
      metadata: raw.metadata && typeof raw.metadata === "object" ? capValue(raw.metadata, 1) : {},
      receivedAt,
    },
  };
}

/** Whole ingest payload → validated batch. */
export function normalizeBatch(payload, { siteId } = {}) {
  if (!payload || typeof payload !== "object") {
    return { ok: false, error: "body must be a JSON object" };
  }

  const site = siteId ?? payload.site ?? payload.siteId;
  if (!site) return { ok: false, error: "site is required" };

  if (!Array.isArray(payload.events)) return { ok: false, error: "events must be an array" };
  if (payload.events.length === 0) return { ok: false, error: "events must not be empty" };
  if (payload.events.length > MAX_BATCH) {
    return { ok: false, error: `max ${MAX_BATCH} events per request` };
  }

  const events = [];
  const rejected = [];

  payload.events.forEach((raw, index) => {
    const result = normalizeEvent(raw, { siteId: site });
    if (result.ok) events.push(result.event);
    else rejected.push({ index, error: result.error });
  });

  if (events.length === 0) return { ok: false, error: "no valid events", rejected };

  events.sort((a, b) => a.timestamp - b.timestamp);
  return { ok: true, site, events, rejected };
}

/* ------------------------------------------------------------------ *
 * Human-readable rendering
 * ------------------------------------------------------------------ */

export function describeEvent(e) {
  const name = e.target?.name ?? e.target?.plugin ?? e.target?.theme ?? e.target?.username;
  const actorName = e.actor?.username;
  const by = actorName ? ` by ${actorName}` : "";
  const from = e.changes?.from;
  const to = e.changes?.to;
  const ver = from && to ? ` ${from} → ${to}` : to ? ` → ${to}` : "";
  const path = e.path ?? e.target?.path;

  switch (e.type) {
    case "plugin_updated":
      return `Plugin "${name}" updated${ver}`;
    case "plugin_installed":
      return `Plugin "${name}" installed${ver}`;
    case "plugin_activated":
      return `Plugin "${name}" activated${by}`;
    case "plugin_deactivated":
      return `Plugin "${name}" deactivated${by}`;
    case "plugin_deleted":
      return `Plugin "${name}" deleted${by}`;

    case "theme_updated":
      return `Theme "${name}" updated${ver}`;
    case "theme_installed":
      return `Theme "${name}" installed${ver}`;
    case "theme_activated":
      return `Theme "${name}" activated${by}`;
    case "theme_deleted":
      return `Theme "${name}" deleted${by}`;

    case "wordpress_updated":
      return `WordPress core updated${ver}`;
    case "core_file_modified":
      return `Core file modified ${path ?? ""}`;
    case "core_integrity_failed":
      return "WordPress core integrity check failed";

    case "files_changed":
      return `${e.count ?? 0} files changed${path ? ` in ${path}` : ""}`;
    case "file_created":
      return `New file created ${path ?? ""}`;
    case "executable_created":
      return `New executable file created ${path ?? ""}`;
    case "file_modified":
      return `File modified ${path ?? ""}`;
    case "file_deleted":
      return `File deleted ${path ?? ""}`;
    case "permission_changed":
      return `Permissions changed ${path ?? ""}${to ? ` → ${to}` : ""}`;

    case "option_changed":
      return `wp_options modified${name ? ` — ${name}` : ""}`;
    case "siteurl_changed":
      return `Site URL changed${from && to ? ` ${from} → ${to}` : ""}`;
    case "home_changed":
      return `Home URL changed${from && to ? ` ${from} → ${to}` : ""}`;
    case "active_plugins_changed":
      return "Active plugins list changed";
    case "registration_setting_changed":
      return "User registration setting changed";
    case "table_changed":
      return `Database table changed${name ? ` — ${name}` : ""}`;

    case "administrator_created":
      return `New administrator created${name ? ` — ${name}` : ""}${
        actorName && actorName !== name ? by : ""
      }`;
    case "user_created":
      return `New user created${name ? ` — ${name}` : ""}${
        actorName && actorName !== name ? by : ""
      }`;
    case "user_deleted":
      return `User deleted${name ? ` — ${name}` : ""}${by}`;
    case "user_role_changed":
      return `Role changed${name ? ` for ${name}` : ""}${ver}${by}`;
    case "password_reset":
      return `Password reset${name ? ` — ${name}` : ""}`;

    case "login_success":
      return `Admin login${actorName ? ` — ${actorName}` : ""}${
        e.actor?.ip ? ` from ${e.actor.ip}` : ""
      }`;
    case "login_failed":
      return `Failed login${name ? ` — ${name}` : ""}${
        e.actor?.ip ? ` from ${e.actor.ip}` : ""
      }${e.count > 1 ? ` (${e.count} attempts)` : ""}`;
    case "login_failed_burst":
      return `${e.count ?? 0} failed logins within ${
        e.metadata?.windowMinutes ?? 5
      } minutes from ${e.metadata?.ipCount ?? 1} IPs`;
    case "logout":
      return `Logout${actorName ? ` — ${actorName}` : ""}`;
    case "application_password_created":
      return `Application password created${name ? ` — ${name}` : ""}`;
    case "application_password_deleted":
      return `Application password deleted${name ? ` — ${name}` : ""}`;

    case "cron_added":
      return `Cron job added${name ? ` — ${name}` : ""}`;
    case "cron_removed":
      return `Cron job removed${name ? ` — ${name}` : ""}`;
    case "cron_modified":
      return `Cron job modified${name ? ` — ${name}` : ""}`;

    case "wp_config_modified":
      return "wp-config.php modified";
    case "htaccess_modified":
      return ".htaccess modified";

    case "redirect_created":
      return `Redirect added${from && to ? ` — ${from} → ${to}` : ""}`;
    case "redirect_modified":
      return `Redirect modified${from && to ? ` — ${from} → ${to}` : ""}`;
    case "redirect_deleted":
      return `Redirect removed${from ? ` — ${from}` : ""}`;
    case "unexpected_redirect":
      return `Unexpected redirect detected${to ? ` → ${to}` : ""}`;

    case "smtp_setting_changed":
      return "SMTP settings changed";
    case "mail_failure":
      return "Mail delivery failure";

    case "dns_record_changed":
      return `DNS record changed${name ? ` — ${name}` : ""}${ver}`;
    case "ssl_expiring":
      return "SSL certificate expiring";
    case "ssl_renewed":
      return "SSL certificate renewed";
    case "ssl_invalid":
      return "SSL certificate invalid";

    case "site_error_burst":
      return `Website started returning errors${
        e.metadata?.httpStatus ? ` (HTTP ${e.metadata.httpStatus})` : ""
      }`;
    case "site_status_changed":
      return `Site status changed${ver}`;

    case "collector_test":
      return e.metadata?.message || "Collector connection test";

    case "users_snapshot": {
      const users = e.metadata?.users ?? [];
      const weak = users.filter((u) => u.weak).length;
      return `User snapshot: ${users.length} account${users.length === 1 ? "" : "s"}, ${weak} weak`;
    }
    case "unexpected_executable":
      return `Unexpected executable: ${path}`;
    case "suspicious_code_detected":
      return `Suspicious code detected in ${path}`;
    case "file_integrity_mismatch":
      return `File changed outside an expected update: ${path}`;
    case "core_file_mismatch":
      return `WordPress core file modified: ${path}`;
    case "plugin_file_mismatch":
      return `Plugin file modified outside an update: ${path}`;
    case "theme_file_mismatch":
      return `Theme file modified outside an update: ${path}`;
    case "file_integrity_scan_completed":
      return `File integrity scan completed (${e.metadata?.filesChecked ?? 0} files, ${e.metadata?.critical ?? 0} critical)`;
    case "file_integrity_scan_failed":
      return `File integrity scan failed${e.metadata?.reason ? ` (${e.metadata.reason})` : ""}`;
    case "site_inventory":
      return `Site inventory: ${e.metadata?.plugins ?? 0} plugins, ${e.metadata?.themes ?? 0} themes, ${e.metadata?.users ?? 0} users`;

    default:
      return name ? `${e.type} — ${name}` : e.type;
  }
}

export function formatClock(ms, timeZone) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  }).format(new Date(ms));
}

export function formatDay(ms, timeZone) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone,
  }).format(new Date(ms));
}

export function gapLabel(fromMs, toMs) {
  const s = Math.max(0, Math.round((toMs - fromMs) / 1000));
  if (s < 60) return `${s}s later`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m later`;
  return `${Math.floor(m / 60)}h ${m % 60}m later`;
}
