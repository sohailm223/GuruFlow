import Link from "next/link";
import { Suspense } from "react";
import { OctagonAlert, Repeat2, ArrowRight } from "lucide-react";
import { getSites, getEvents, getIncidents } from "@/lib/blackbox/storage";
import { groupErrors, correlateError, errorKind, ERROR_EVENT_TYPES } from "@/lib/blackbox/errors";
import { timeAgo, nowMs } from "@/lib/blackbox/sites";
import ErrorFilters from "@/app/components/blackbox/ErrorFilters";

export const dynamic = "force-dynamic";

/**
 * Errors — every error family the collector records, grouped by fingerprint so
 * a crash loop is one card rather than fifty.
 *
 * Each card answers the same eight questions whatever the family: what failed,
 * where, when, how often, which component, what changed before it, what the
 * evidence is, and what to check first.
 *
 * The "what changed" line is derived from recorded change events in the same
 * window. When nothing recorded explains an error, the card says so instead of
 * guessing — a weak link reads "Related change detected", never a cause.
 */
export default async function ErrorsPage({ searchParams }) {
  const sp = await searchParams;
  const kind = typeof sp?.kind === "string" ? sp.kind : "";

  const [sites, events, incidents] = await Promise.all([getSites(), getEvents(2000), getIncidents(200)]);
  const now = nowMs();

  const errorEvents = events.filter((e) => ERROR_EVENT_TYPES.includes(e.type));
  const groups = groupErrors(errorEvents);

  const siteName = (id) => sites.find((s) => s.id === id)?.name ?? "Unknown website";

  // Correlate each group against its own site's events, so a change on one
  // website is never offered as the cause of an error on another.
  const rows = groups.map((g) => {
    const siteEvents = events.filter((e) => e.siteId === g.siteId);
    const correlation = correlateError(g, siteEvents);
    const related =
      incidents.find(
        (i) => i.siteId === g.siteId && g.firstSeen >= (i.startedAt ?? 0) - 60_000 && g.firstSeen <= (i.endedAt ?? Infinity) + 60_000
      ) ?? null;
    return { ...g, correlation, siteName: siteName(g.siteId), relatedIncident: related };
  });

  // Filter server-side. Doing it here rather than in the client component keeps
  // a filtered-out error out of the rendered markup entirely.
  const visible = kind ? rows.filter((r) => r.family === kind) : rows;

  const repeating = rows.filter((r) => r.repeating);
  const withCause = rows.filter((r) => r.correlation.likelyCause);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Errors</h1>
        <p className="mt-1 text-sm text-slate-400">
          PHP, HTTP, REST, AJAX, database, email, cron and browser errors recorded by the
          collector, grouped by fingerprint. Duplicates collapse into one card with a
          first-seen and last-seen window.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Distinct errors" value={rows.length} tone="rose" />
        <Stat label="Repeating" value={repeating.length} tone="amber" />
        <Stat label="With a related change" value={withCause.length} tone="orange" />
      </div>

      <Suspense fallback={null}>
        <ErrorFilters />
      </Suspense>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-8 text-center">
          <OctagonAlert className="mx-auto h-8 w-8 text-slate-600" />
          <p className="mt-3 text-sm text-slate-300">
            {rows.length === 0 ? "No errors recorded yet" : "No errors of this type recorded yet"}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {rows.length === 0
              ? "The collector queues errors as they happen and delivers them on the next WP-Cron run. Nothing has arrived yet for any connected website."
              : "Errors of other types have been recorded. Clear the filter to see them."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {visible.map((r) => (
            <article
              key={r.fingerprint}
              className="rounded-xl border border-slate-800 bg-slate-900/40 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-teal-400">
                    {r.familyLabel} error
                  </p>
                  <h2 className="mt-1 truncate text-sm font-medium text-slate-100">{r.whatFailed}</h2>
                  <p className="mt-0.5 truncate font-mono text-xs text-slate-400">{r.where ?? "location not recorded"}</p>
                </div>
                {r.status ? (
                  <span className="shrink-0 rounded bg-rose-500/10 px-2 py-1 font-mono text-xs font-semibold text-rose-400">
                    {r.status}
                  </span>
                ) : null}
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <Field label="Website" value={r.siteName} />
                <Field label="Component" value={r.componentName ?? r.componentLabel} />
                <Field label="Error code" value={r.code} mono />
                <Field label="File + line" value={r.relativePath ? `${r.relativePath}${r.line ? `:${r.line}` : ""}` : null} mono />
                <Field label="First seen" value={timeAgo(r.firstSeen, now)} />
                <Field label="Last seen" value={timeAgo(r.lastSeen, now)} />
                <Field
                  label="Occurrences"
                  value={String(r.occurrences)}
                  mono
                  tone={r.repeating ? "text-amber-400" : undefined}
                />
                <Field
                  label="Related incident"
                  value={r.relatedIncident ? r.relatedIncident.title ?? r.relatedIncident.id : null}
                  href={r.relatedIncident ? `/incidents/${r.relatedIncident.id}` : null}
                />
              </dl>

              <FamilyDetail group={r} />

              {r.repeating ? (
                <p className="mt-3 inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                  <Repeat2 className="h-3 w-3" /> Repeating
                </p>
              ) : null}

              {r.correlation.likelyCause ? (
                <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/50 p-3">
                  <p className="text-xs font-medium text-slate-200">{r.correlation.likelyCause}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {r.correlation.causeStrength === "strong" ? "Strong evidence" : "Related change detected"} ·
                    Confidence {r.correlation.confidence}% ({r.correlation.confidenceLabel})
                    {r.correlation.firstSeenAfter
                      ? ` · first seen ${describeGap(r.correlation.firstSeenAfter.gap)} after ${r.correlation.firstSeenAfter.change.replace(/_/g, " ")}`
                      : ""}
                  </p>
                  <ul className="mt-2 space-y-1 text-[11px] text-slate-500">
                    {r.correlation.evidence.slice(0, 3).map((ev, i) => (
                      <li key={i}>• {ev.text}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="mt-3 rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-[11px] text-slate-500">
                  {r.correlation.explanation}
                </p>
              )}

              {r.relatedIncident ? (
                <Link
                  href={`/incidents/${r.relatedIncident.id}`}
                  className="mt-3 inline-flex items-center gap-1 text-xs text-teal-400 hover:text-teal-300"
                >
                  View evidence <ArrowRight className="h-3 w-3" />
                </Link>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The extra detail a family recorded, as inline chips.
 *
 * Rendered only for fields the collector actually sent, so a database error
 * does not show an empty "Schedule" and a cron error does not show an empty
 * "Endpoint". A field that was not recorded is simply absent.
 *
 * @param {object} group
 */
function FamilyDetail({ group: g }) {
  const chips = [];

  if (g.endpoint) chips.push(["Endpoint", `${g.httpMethod ? `${g.httpMethod} ` : ""}${g.endpoint}`]);
  if (g.ajaxAction) chips.push(["Action", g.ajaxAction]);
  if (g.queryType) chips.push(["Query", g.queryType]);
  if (g.table) chips.push(["Table", g.table]);
  if (g.transport) chips.push(["Transport", g.transport]);
  if (g.cronHook) chips.push(["Hook", g.cronHook]);
  if (g.schedule) chips.push(["Schedule", g.schedule]);
  if (g.scriptUrl) chips.push(["Script", `${g.scriptUrl}${g.line ? `:${g.line}${g.column ? `:${g.column}` : ""}` : ""}`]);
  if (g.pageUrl) chips.push(["Page", g.pageUrl]);
  if (g.browser) chips.push(["Browser", g.browser]);
  if (g.context) chips.push(["Context", g.context]);
  if (g.responseTimeMs != null) chips.push(["Response time", `${g.responseTimeMs} ms`]);

  if (!chips.length) return null;

  return (
    <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-800 pt-3">
      {chips.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-[10px] uppercase tracking-wide text-slate-600">{label}</dt>
          <dd className="truncate font-mono text-xs text-slate-300">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function describeGap(ms) {
  const m = Math.round(Math.abs(ms) / 60_000);
  if (m < 1) return "under a minute";
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"}`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"}`;
  return `${Math.round(h / 24)} day${Math.round(h / 24) === 1 ? "" : "s"}`;
}

function Field({ label, value, mono, tone, href }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-slate-600">{label}</dt>
      <dd className={`truncate ${mono ? "font-mono " : ""}${tone ?? "text-slate-300"}`}>
        {href ? (
          <Link href={href} className="text-teal-400 hover:text-teal-300">
            {value}
          </Link>
        ) : (
          value ?? <span className="text-slate-600">not recorded</span>
        )}
      </dd>
    </div>
  );
}

function Stat({ label, value, tone }) {
  const tones = { rose: "text-rose-400", orange: "text-orange-400", amber: "text-amber-400" };
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tones[tone] ?? "text-slate-200"}`}>{value}</p>
    </div>
  );
}
