/**
 * Turns a structured Black Box event into the one-line human sentence shown
 * in the timeline (the "11:03 AM — Plugin "Elementor Pro" updated" style).
 */

export function describeEvent(e) {
  const actorName = e.actor?.name;
  const actor = actorName ? ` by ${actorName}` : "";
  const ver =
    e.from && e.to ? ` ${e.from} → ${e.to}` : e.to ? ` → ${e.to}` : "";

  switch (e.type) {
    case "plugin.updated":
      return `Plugin "${e.target}" updated${ver}`;
    case "plugin.installed":
      return `Plugin "${e.target}" installed${ver}`;
    case "plugin.activated":
      return `Plugin "${e.target}" activated${actor}`;
    case "plugin.deactivated":
      return `Plugin "${e.target}" deactivated${actor}`;
    case "plugin.deleted":
      return `Plugin "${e.target}" deleted${actor}`;

    case "theme.updated":
      return `Theme "${e.target}" updated${ver}`;
    case "theme.installed":
      return `Theme "${e.target}" installed${ver}`;
    case "theme.activated":
      return `Theme "${e.target}" activated${actor}`;

    case "core.updated":
      return `WordPress core updated${ver}`;

    case "files.changed":
      return `${e.count ?? 0} files changed${e.path ? ` in ${e.path}` : ""}`;
    case "file.created":
      return `New file created ${e.path ?? ""}${e.meta?.executable ? " (executable)" : ""}`;
    case "file.modified":
      return `File modified ${e.path ?? ""}`;
    case "file.deleted":
      return `File deleted ${e.path ?? ""}`;

    case "db.option_changed":
      return `wp_options modified${e.target ? ` — ${e.target}` : ""}`;
    case "db.table_changed":
      return `Database table changed${e.target ? ` — ${e.target}` : ""}`;

    case "user.created":
      // Skip the "by" suffix when the created account is itself the actor —
      // otherwise it reads "New administrator created — bob by bob".
      return `New ${e.to ?? "user"} created${e.target ? ` — ${e.target}` : ""}${
        actorName && actorName !== e.target ? actor : ""
      }`;
    case "user.role_changed":
      return `Role changed${e.target ? ` for ${e.target}` : ""}${ver}${actor}`;
    case "user.deleted":
      return `User deleted${e.target ? ` — ${e.target}` : ""}${actor}`;

    case "cron.created":
      return `Cron job added${e.target ? ` — ${e.target}` : ""}`;
    case "cron.deleted":
      return `Cron job removed${e.target ? ` — ${e.target}` : ""}`;

    case "htaccess.modified":
      return `.htaccess modified`;
    case "wpconfig.modified":
      return `wp-config.php modified`;

    case "dns.record_changed":
      return `DNS record changed${e.target ? ` — ${e.target}` : ""}${ver}`;
    case "ssl.expiring":
      return `SSL certificate expiring${e.target ? ` (${e.target})` : ""}`;
    case "ssl.renewed":
      return `SSL certificate renewed`;
    case "ssl.invalid":
      return `SSL certificate invalid`;

    case "smtp.settings_changed":
      return `SMTP settings changed`;

    case "redirect.added":
      return `Redirect added${e.from && e.to ? ` — ${e.from} → ${e.to}` : ""}`;
    case "redirect.removed":
      return `Redirect removed${e.from ? ` — ${e.from}` : ""}`;

    case "admin_login.success":
      return `Admin login${actorName ? ` — ${actorName}` : ""}${
        e.sourceIp ? ` from ${e.sourceIp}` : ""
      }`;
    case "admin_login.failed":
      return `Failed admin login${e.target ? ` — ${e.target}` : ""}${
        e.sourceIp ? ` from ${e.sourceIp}` : ""
      }${e.count && e.count > 1 ? ` (${e.count} attempts)` : ""}`;

    case "site.error_burst":
      return `Website started returning errors${
        e.meta?.httpStatus ? ` (HTTP ${e.meta.httpStatus})` : ""
      }`;
    case "site.status_changed":
      return `Site status changed${ver}`;

    default:
      return e.target ? `${e.type} — ${e.target}` : e.type;
  }
}

/** 12-hour clock, matching the mock output ("11:03 AM"). */
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

/** Seconds between two ms timestamps, 1 decimal. */
export function gapLabel(fromMs, toMs) {
  const s = Math.max(0, Math.round((toMs - fromMs) / 1000));
  if (s < 60) return `${s}s later`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m later`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m later`;
}
