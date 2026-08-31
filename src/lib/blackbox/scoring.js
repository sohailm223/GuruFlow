/**
 * Event-level risk scoring.
 *
 * These are raw internal points. They are deliberately unbounded so unusual
 * bursts can stand out; `scoring.normalize` maps them onto the 0–100 scale
 * that is shown to users.
 */

/** Directories where executable code should never appear. */
export const SUSPICIOUS_PATHS = [
  "/wp-content/uploads/",
  "/wp-includes/",
  "/wp-content/upgrade/",
  "/wp-content/cache/",
  "/wp-content/wflogs/",
  "/tmp/",
];

const EXECUTABLE_EXT = /\.(php|phtml|phar|pl|py|sh|cgi)$/i;
const SENSITIVE_OPTIONS =
  /^(siteurl|home|admin_email|active_plugins|template|stylesheet|users_can_register|default_role)$/i;
const BOOTSTRAP_FILES = /wp-(config\.php|settings\.php|load\.php)|wp-admin\/includes|wp-includes\//i;

export function isSuspiciousPath(path) {
  if (!path) return false;
  const p = path.startsWith("/") ? path : `/${path}`;
  return SUSPICIOUS_PATHS.some((bad) => p.includes(bad));
}

export function isExecutablePath(path) {
  return EXECUTABLE_EXT.test(path ?? "");
}

export function scoreEvent(e) {
  const flags = [];
  let score = 0;
  const add = (points, why) => {
    score += points;
    flags.push(why);
  };

  const path = e.path ?? e.target?.path;
  const toRole = e.changes?.to ?? e.target?.role;

  switch (e.type) {
    case "executable_created":
      add(45, "New executable file created");
      if (isSuspiciousPath(path)) add(30, "Inside a directory that should be data-only");
      break;

    case "file_created":
      if (isExecutablePath(path)) {
        add(45, "New executable file created");
        if (isSuspiciousPath(path)) add(30, "Inside a directory that should be data-only");
      } else {
        add(6, "New file created");
      }
      break;

    case "file_modified":
      if (BOOTSTRAP_FILES.test(path ?? "")) add(25, "Core bootstrap file modified");
      else if (isSuspiciousPath(path)) add(20, "Modified file in a sensitive directory");
      else add(4, "File modified");
      break;

    case "core_file_modified":
      add(28, "WordPress core file modified");
      break;

    case "core_integrity_failed":
      add(40, "Core integrity check failed");
      break;

    case "file_deleted":
      add(10, "File deleted");
      break;

    case "permission_changed":
      add(/7[57]7|666/.test(String(e.changes?.to ?? "")) ? 18 : 8, "File permissions changed");
      break;

    case "files_changed":
      add(Math.min(20, Math.ceil((e.count ?? 0) / 10)), `${e.count ?? 0} files changed at once`);
      break;

    case "administrator_created":
      add(35, "New administrator account");
      break;

    case "user_created":
      if (/admin/i.test(toRole ?? "")) add(35, "New administrator account");
      else add(12, "New user account");
      break;

    case "user_role_changed":
      if (/admin/i.test(toRole ?? "")) add(30, "Account escalated to administrator");
      else add(10, "User role changed");
      break;

    case "user_deleted":
      add(8, "User deleted");
      break;

    case "password_reset":
      add(10, "Password reset");
      break;

    case "application_password_created":
      add(14, "Application password created (persistent API access)");
      break;
    case "application_password_deleted":
      add(4, "Application password deleted");
      break;

    case "wp_config_modified":
      add(30, "wp-config.php modified");
      break;

    case "htaccess_modified":
      add(28, ".htaccess modified");
      break;

    case "siteurl_changed":
    case "home_changed":
      add(32, "Site or home URL changed (where the site points)");
      break;

    case "registration_setting_changed":
      add(20, "Open user registration enabled");
      break;

    case "active_plugins_changed":
      add(8, "Active plugins list changed");
      break;

    case "option_changed": {
      const name = e.target?.name ?? e.target?.option;
      if (SENSITIVE_OPTIONS.test(name ?? "")) add(25, `Security-sensitive option changed (${name})`);
      else add(6, "wp_options modified");
      break;
    }

    case "table_changed":
      add(8, "Database table changed");
      break;

    case "cron_added":
      add(12, "Scheduled job added (runs without a logged-in user)");
      break;
    case "cron_modified":
      add(8, "Scheduled job modified");
      break;
    case "cron_removed":
      add(3, "Scheduled job removed");
      break;

    case "redirect_created":
    case "redirect_modified":
      add(22, "Redirect added (where visitors are sent)");
      break;
    case "unexpected_redirect":
      add(28, "Unexpected redirect detected");
      break;
    case "redirect_deleted":
      add(6, "Redirect removed");
      break;

    case "smtp_setting_changed":
      add(15, "SMTP settings changed (where outbound mail is delivered)");
      break;
    case "mail_failure":
      add(8, "Mail delivery failure");
      break;

    case "dns_record_changed":
      add(28, "DNS record changed (where the domain resolves)");
      break;

    case "ssl_invalid":
      add(20, "SSL certificate invalid");
      break;
    case "ssl_expiring":
      add(5, "SSL certificate expiring");
      break;
    case "ssl_renewed":
      add(1, "SSL certificate renewed");
      break;

    case "login_failed":
      add(Math.min(20, 5 + (e.count ?? 1)), `Failed login${e.count > 1 ? ` ×${e.count}` : ""}`);
      break;

    case "login_failed_burst":
      add(Math.min(45, 22 + Math.floor((e.count ?? 0) / 3)), `${e.count ?? 0} failed logins`);
      break;

    case "login_success":
      add(5, "Admin login");
      if (e.metadata?.newLocation) add(12, "Login from a new location");
      break;

    case "logout":
      add(1, "Logout");
      break;

    case "php_error": {
      // A fatal means the request did not complete. Weight repeats so a crash
      // loop scores above a one-off, but cap it: frequency is not severity.
      const n = Math.min(e.metadata?.occurrences ?? 1, 20);
      add(35 + n, `PHP fatal error recorded${n > 1 ? ` (${n} occurrences)` : ""} (impact)`);
      break;
    }

    case "http_error": {
      const n = Math.min(e.metadata?.occurrences ?? 1, 20);
      add(25 + n, `Server returned a 5xx response${n > 1 ? ` (${n} occurrences)` : ""} (impact)`);
      break;
    }

    case "rest_error": {
      const n = Math.min(e.metadata?.occurrences ?? 1, 20);
      const st = e.metadata?.status ? ` (HTTP ${e.metadata.status})` : "";
      add(20 + n, `REST API request failed${st}${n > 1 ? ` (${n} occurrences)` : ""} (impact)`);
      break;
    }

    case "ajax_error": {
      const n = Math.min(e.metadata?.occurrences ?? 1, 20);
      add(18 + n, `admin-ajax request failed${n > 1 ? ` (${n} occurrences)` : ""} (impact)`);
      break;
    }

    case "db_error": {
      const n = Math.min(e.metadata?.occurrences ?? 1, 20);
      add(28 + n, `Database error recorded${n > 1 ? ` (${n} occurrences)` : ""} (impact)`);
      break;
    }

    case "mail_error": {
      const n = Math.min(e.metadata?.occurrences ?? 1, 20);
      add(12 + n, `Email delivery failed${n > 1 ? ` (${n} occurrences)` : ""} (impact)`);
      break;
    }

    case "cron_error": {
      const n = Math.min(e.metadata?.occurrences ?? 1, 20);
      add(20 + n, `Scheduled task failed${n > 1 ? ` (${n} occurrences)` : ""} (impact)`);
      break;
    }

    case "js_error": {
      const n = Math.min(e.metadata?.occurrences ?? 1, 20);
      add(10 + n, `Browser JavaScript error recorded${n > 1 ? ` (${n} occurrences)` : ""} (impact)`);
      break;
    }

    case "wp_error": {
      const n = Math.min(e.metadata?.occurrences ?? 1, 20);
      add(14 + n, `WordPress raised an error${n > 1 ? ` (${n} occurrences)` : ""} (impact)`);
      break;
    }

    case "site_error_burst":
      add(25, "Site started returning errors (impact)");
      break;

    case "site_status_changed":
      add(10, "Site status changed");
      break;

    case "plugin_updated":
    case "theme_updated":
      add(6, "Component updated");
      break;
    case "wordpress_updated":
      add(6, "WordPress core updated");
      break;

    case "plugin_installed":
    case "theme_installed":
      add(12, "New component installed");
      break;

    case "plugin_activated":
      add(8, "Plugin activated");
      break;
    case "plugin_deactivated":
      add(6, "Plugin deactivated");
      break;
    case "plugin_deleted":
    case "theme_deleted":
      add(8, "Component deleted");
      break;

    case "collector_test":
      add(0, "Collector self-test");
      break;

    default:
      add(2, e.type);
  }

  if (e.actor?.username && e.actor.username !== "system") add(2, "Attributed to a user");

  return { event: e, score, flags };
}
