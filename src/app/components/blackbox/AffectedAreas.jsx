/**
 * What was affected.
 *
 * Three honest states:
 *   Affected      — a recorded event touches this area in this incident
 *   Not monitored — the collector does not watch this at all
 *   Unknown       — it could be involved and ScanSite has no evidence either way
 *
 * "Unknown" is never upgraded to "Affected" for effect, and never downgraded to
 * "Not affected" — absence of evidence is reported as absence of evidence.
 */
const AREAS = [
  { key: "accounts", label: "Administrator Accounts", types: ["administrator_created", "user_created", "user_role_changed", "user_deleted", "password_reset"] },
  { key: "auth", label: "Authentication", types: ["login_success", "login_failed", "login_failed_burst", "application_password_created", "application_password_deleted"] },
  { key: "files", label: "File Integrity", types: ["file_created", "file_modified", "file_deleted", "executable_created", "unexpected_executable", "file_integrity_mismatch", "core_file_mismatch", "plugin_file_mismatch", "theme_file_mismatch", "suspicious_code_detected"] },
  { key: "plugins", label: "Plugins", types: ["plugin_installed", "plugin_activated", "plugin_deactivated", "plugin_updated", "plugin_deleted", "active_plugins_changed"] },
  { key: "themes", label: "Themes", types: ["theme_installed", "theme_activated", "theme_updated", "theme_deleted"] },
  { key: "cron", label: "Cron", types: ["cron_added", "cron_removed", "cron_modified"] },
  { key: "config", label: "Configuration", types: ["wp_config_modified", "htaccess_modified", "siteurl_changed", "home_changed", "option_changed"] },
  { key: "redirects", label: "Redirects", types: ["redirect_created", "redirect_modified", "redirect_deleted", "unexpected_redirect"] },
  { key: "availability", label: "Website Availability", types: ["site_error_burst", "site_status_changed"] },
  { key: "email", label: "Email", types: ["smtp_setting_changed", "mail_failure"] },
];

const STATE_STYLE = {
  Affected: "bg-rose-50 text-rose-700",
  Unknown: "bg-slate-100 text-slate-600",
  "Not monitored": "bg-slate-50 text-slate-400",
};

export default function AffectedAreas({ incident }) {
  const types = new Set((incident.events ?? []).map((e) => e.type));
  const counts = new Map();
  for (const e of incident.events ?? []) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);

  const rows = AREAS.map((area) => {
    const hit = area.types.filter((t) => types.has(t));
    const n = hit.reduce((sum, t) => sum + (counts.get(t) ?? 0), 0);
    return {
      label: area.label,
      state: hit.length ? "Affected" : area.key === "dns" ? "Not monitored" : "Unknown",
      detail: hit.length ? `${n} event${n === 1 ? "" : "s"}` : area.key === "dns" ? "Collector does not watch DNS" : "No evidence either way",
    };
  });

  // DNS and SSL are in the schema but not monitored by the collector yet.
  rows.push({ label: "DNS", state: "Not monitored", detail: "Collector does not watch DNS" });
  rows.push({ label: "SSL", state: "Not monitored", detail: "Collector does not watch certificates" });

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">What Was Affected</h2>

      <table className="mt-4 w-full text-left text-sm">
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="py-2 text-slate-700">{r.label}</td>
              <td className="py-2">
                <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATE_STYLE[r.state]}`}>{r.state}</span>
              </td>
              <td className="py-2 text-right text-xs text-slate-500">{r.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-3 text-xs text-slate-400">
        &quot;Unknown&quot; means ScanSite has no evidence in this window, not that the area is safe.
      </p>
    </section>
  );
}
