import { CATEGORIES } from "@/lib/incidents/eventSchema";

const LABELS = {
  core: "WordPress core",
  plugin: "Plugins",
  theme: "Themes",
  file: "Files",
  db: "Database",
  user: "Users",
  cron: "WP-Cron",
  config: ".htaccess / wp-config",
  dns: "DNS",
  ssl: "SSL",
  smtp: "SMTP",
  redirect: "Redirects",
  auth: "Admin logins",
};

/**
 * Shows what the collector watches, and highlights the categories that
 * actually produced signal in a given incident.
 */
export default function MonitoredSources({ active = [] }) {
  const activeSet = new Set(active);

  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-slate-400">
        Monitoring
      </p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {CATEGORIES.map((c) => {
          const isActive = activeSet.has(c);
          return (
            <li
              key={c}
              className={`rounded-full px-2.5 py-1 font-mono text-[11px] ring-1 ${
                isActive
                  ? "bg-slate-900 text-slate-100 ring-slate-900"
                  : "bg-white text-slate-500 ring-slate-200"
              }`}
            >
              {LABELS[c] ?? c}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
