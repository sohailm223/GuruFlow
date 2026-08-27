import { CATEGORY_LABELS, CATEGORIES, NOT_MONITORED_BY_COLLECTOR } from "@/lib/blackbox/schemas";

/**
 * What the collector reported about this WordPress install, plus what it does
 * and does not watch. Areas the collector cannot observe are labelled as such
 * rather than shown as healthy.
 */
export default function WebsiteEnvironment({ site }) {
  const wp = site.wordpress ?? {};
  const capability = site.capability ?? {};

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Environment</h2>

      <dl className="mt-4 space-y-2.5 text-sm">
        <Row label="WordPress" value={wp.wordpressVersion ?? "—"} />
        <Row label="PHP" value={wp.phpVersion ?? "—"} />
        <Row label="Collector" value={wp.pluginVersion ?? site.collectorVersion ?? "—"} />
        <Row label="Multisite" value={wp.multisite ? "Yes" : "No"} />
        <Row
          label="Theme"
          value={capability.theme ? `${capability.theme.name} ${capability.theme.version ?? ""}`.trim() : "—"}
        />
        <Row
          label="Plugins"
          value={
            capability.plugins
              ? `${capability.plugins.active ?? 0} active`
              : "—"
          }
        />
      </dl>

      <div className="mt-6 border-t border-slate-100 pt-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Monitored</p>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {CATEGORIES.map((category) => {
            const unsupported = NOT_MONITORED_BY_COLLECTOR.includes(category);
            return (
              <li
                key={category}
                title={
                  unsupported ? "Not monitored by collector yet" : CATEGORY_LABELS[category]
                }
                className={`rounded-full px-2.5 py-1 text-xs ring-1 ring-inset ${
                  unsupported
                    ? "bg-slate-50 text-slate-400 ring-slate-200 line-through"
                    : "bg-slate-100 text-slate-600 ring-slate-200"
                }`}
              >
                {CATEGORY_LABELS[category]}
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-xs text-slate-400">
          DNS and SSL are not monitored by the collector yet.
        </p>
      </div>
    </section>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className="truncate font-medium text-slate-800">{value}</dd>
    </div>
  );
}
