import Link from "next/link";
import { timeAgo } from "@/lib/blackbox/sites";

const WEBSITE_HEALTH = {
  critical: { label: "Critical", dot: "bg-rose-500" },
  attention: { label: "Attention", dot: "bg-amber-500" },
  healthy: { label: "Healthy", dot: "bg-teal-500" },
};

const COLLECTOR_TONE = {
  ok: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  warn: "bg-amber-50 text-amber-700 ring-amber-600/20",
  bad: "bg-rose-50 text-rose-700 ring-rose-600/20",
  pending: "bg-slate-100 text-slate-600 ring-slate-500/20",
  neutral: "bg-slate-100 text-slate-600 ring-slate-500/20",
};

/**
 * A compact scan of every connected website. Website health, collector status
 * and incident severity are kept visually separate — they answer different
 * questions.
 */
export default function SiteHealthTable({ sites, now }) {
  if (!sites.length) return null;

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
        <h2 className="text-sm font-semibold tracking-wide text-slate-700 uppercase">Websites</h2>
        <Link href="/websites" className="text-xs font-semibold text-rose-700 hover:text-rose-800">
          Manage all →
        </Link>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-2.5 font-medium">Website</th>
              <th className="px-5 py-2.5 font-medium">Collector</th>
              <th className="px-5 py-2.5 font-medium">Last seen</th>
              <th className="px-5 py-2.5 font-medium">Files</th>
              <th className="px-5 py-2.5 font-medium">Risk</th>
              <th className="px-5 py-2.5 font-medium">Open issues</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sites.map(({ site, collector, stats, websiteHealth, fileStats }) => {
              const health = WEBSITE_HEALTH[websiteHealth] ?? WEBSITE_HEALTH.healthy;
              return (
                <tr key={site.id}>
                  <td className="px-5 py-3">
                    <Link
                      href={`/websites/${site.id}`}
                      className="flex items-center gap-2 font-medium text-slate-900 hover:text-rose-700"
                    >
                      <span
                        className={`h-2.5 w-2.5 shrink-0 rounded-full ${health.dot}`}
                        aria-hidden
                      />
                      <span className="truncate">{site.name}</span>
                    </Link>
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                        COLLECTOR_TONE[collector.tone] ?? COLLECTOR_TONE.neutral
                      }`}
                    >
                      {collector.label}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-slate-600">
                    {collector.since ? timeAgo(collector.since, now) : "Never"}
                  </td>
                  <td className="px-5 py-3">
                    {fileStats?.checked ? (
                      fileStats.critical ? (
                        <span className="rounded-md bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">
                          {fileStats.critical} critical
                        </span>
                      ) : fileStats.suspicious ? (
                        <span className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                          {fileStats.suspicious} suspicious
                        </span>
                      ) : (
                        <span className="text-slate-400">Verified</span>
                      )
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={
                        stats.risk >= 80
                          ? "font-semibold text-rose-700"
                          : stats.risk > 0
                            ? "font-medium text-slate-700"
                            : "text-slate-400"
                      }
                    >
                      {stats.risk || "—"}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={
                        stats.critical > 0
                          ? "rounded-md bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700"
                          : stats.open > 0
                            ? "rounded-md bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700"
                            : "text-slate-400"
                      }
                    >
                      {stats.open ? `${stats.open} open` : "None"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
