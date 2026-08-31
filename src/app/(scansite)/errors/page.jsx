import Link from "next/link";
import { OctagonAlert, Repeat2, ArrowRight, FileCode2 } from "lucide-react";
import { getSites, getEvents, getIncidents } from "@/lib/blackbox/storage";
import { groupErrors, correlateError } from "@/lib/blackbox/errors";
import { timeAgo, nowMs } from "@/lib/blackbox/sites";

export const dynamic = "force-dynamic";

/**
 * Errors — recorded PHP fatal errors, uncaught exceptions and HTTP 5xx
 * responses, grouped so a crash loop is one row rather than fifty.
 *
 * Everything here is what the collector recorded. The "Likely cause" column is
 * derived from recorded change events in the same window; when nothing recorded
 * explains an error, the row says so instead of guessing.
 */
export default async function ErrorsPage() {
  const [sites, events, incidents] = await Promise.all([getSites(), getEvents(2000), getIncidents(200)]);
  const now = nowMs();

  const errorEvents = events.filter((e) => e.type === "php_error" || e.type === "http_error");
  const groups = groupErrors(errorEvents);

  const siteName = (id) => sites.find((s) => s.id === id)?.name ?? "Unknown website";

  // Correlate each group against its own site's events, so a change on one
  // website is never offered as the cause of an error on another.
  const rows = groups.map((g) => {
    const siteEvents = events.filter((e) => e.siteId === g.siteId);
    const correlation = correlateError(g, siteEvents);
    // The incident that covers the time this error was first recorded.
    const related =
      incidents.find(
        (i) => i.siteId === g.siteId && g.firstSeen >= (i.startedAt ?? 0) - 60_000 && g.firstSeen <= (i.endedAt ?? Infinity) + 60_000
      ) ?? null;
    return { ...g, correlation, siteName: siteName(g.siteId), relatedIncident: related };
  });

  const fatals = rows.filter((r) => r.type === "php_error");
  const httpErrors = rows.filter((r) => r.type === "http_error");
  const repeating = rows.filter((r) => r.repeating);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Errors</h1>
        <p className="mt-1 text-sm text-slate-400">
          PHP fatal errors, uncaught exceptions and HTTP 5xx responses recorded by the collector,
          grouped by fingerprint. Duplicates are collapsed into one row with a first-seen and
          last-seen window.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Fatal errors" value={fatals.length} tone="rose" />
        <Stat label="HTTP 5xx" value={httpErrors.length} tone="orange" />
        <Stat label="Repeating" value={repeating.length} tone="amber" />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-8 text-center">
          <OctagonAlert className="mx-auto h-8 w-8 text-slate-600" />
          <p className="mt-3 text-sm text-slate-300">No errors recorded yet</p>
          <p className="mt-1 text-xs text-slate-500">
            The collector queues a PHP fatal error, uncaught exception or HTTP 5xx response and
            delivers it on the next WP-Cron run. Nothing has arrived yet for any connected website.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900/70 text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-3">Error</th>
                <th className="px-4 py-3">Component</th>
                <th className="px-4 py-3">File + line</th>
                <th className="px-4 py-3">First seen</th>
                <th className="px-4 py-3">Last seen</th>
                <th className="px-4 py-3 text-right">Occurrences</th>
                <th className="px-4 py-3">Website</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 bg-slate-950/40">
              {rows.map((r) => (
                <tr key={r.fingerprint} className="align-top">
                  <td className="px-4 py-3">
                    <div className="flex items-start gap-2">
                      {r.type === "http_error" ? (
                        <OctagonAlert className="mt-0.5 h-4 w-4 shrink-0 text-orange-400" />
                      ) : (
                        <FileCode2 className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                      )}
                      <div>
                        <p className="font-medium text-slate-200">{r.severity ?? "Error"}</p>
                        <p className="mt-0.5 line-clamp-2 max-w-md text-xs text-slate-400">
                          {r.message ?? "No message recorded"}
                        </p>
                        {r.repeating ? (
                          <p className="mt-1 inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                            <Repeat2 className="h-3 w-3" /> Repeating
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-300">
                    {r.componentName ?? r.componentLabel}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-400">
                    {r.relativePath ? (
                      <>
                        {r.relativePath}
                        {r.line ? <span className="text-rose-400">:{r.line}</span> : null}
                      </>
                    ) : (
                      <span className="text-slate-600">not recorded</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">{timeAgo(r.firstSeen, now)}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">{timeAgo(r.lastSeen, now)}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-slate-300">
                    {r.occurrences}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-300">
                    {r.siteName}
                    {r.relatedIncident ? (
                      <Link
                        href={`/incidents/${r.relatedIncident.id}`}
                        className="mt-1 flex items-center gap-1 text-[11px] text-teal-400 hover:text-teal-300"
                      >
                        Related incident <ArrowRight className="h-3 w-3" />
                      </Link>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 ? (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-200">Likely cause, where the events support one</h2>
          {rows.map((r) => (
            <div key={`c-${r.fingerprint}`} className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
              <p className="font-mono text-xs text-slate-400">
                {r.relativePath ?? "unknown location"}
                {r.line ? `:${r.line}` : ""}
              </p>
              {r.correlation.likelyCause ? (
                <>
                  <p className="mt-2 text-sm text-slate-200">{r.correlation.likelyCause}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    Confidence {r.correlation.confidence}% ({r.correlation.confidenceLabel})
                  </p>
                  <ul className="mt-2 space-y-1 text-xs text-slate-400">
                    {r.correlation.evidence.map((ev, i) => (
                      <li key={i}>• {ev.text}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="mt-2 text-sm text-slate-400">{r.correlation.explanation}</p>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value, tone }) {
  const tones = {
    rose: "text-rose-400",
    orange: "text-orange-400",
    amber: "text-amber-400",
  };
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tones[tone] ?? "text-slate-200"}`}>{value}</p>
    </div>
  );
}
