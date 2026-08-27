import Link from "next/link";
import SetPageTitle from "@/app/components/common/SetPageTitle";
import RiskBadge from "@/app/components/blackbox/RiskBadge";
import MonitoredSources from "@/app/components/blackbox/MonitoredSources";
import DemoLoader from "@/app/components/blackbox/DemoLoader";
import { assertBlackboxAccess } from "@/lib/incidents/access";
import { listIncidents, listSites } from "@/lib/incidents/store";
import { formatClock, formatDay } from "@/lib/incidents/narrative";

export const dynamic = "force-dynamic";

export default async function IncidentsPage() {
  const denied = await assertBlackboxAccess();
  if (denied) return <Denied hint={denied.body.hint} />;

  const [incidents, sites] = await Promise.all([listIncidents(), listSites()]);

  return (
    <div className="space-y-6">
      <SetPageTitle title="Incidents" />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">
            Website Incident Timeline
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Every change a site made, in order. When something breaks, this
            answers <span className="font-medium text-slate-700">what changed,
            when, and what probably caused it</span> — instead of hours of
            “did anyone touch anything?”.
          </p>
        </div>
        <DemoLoader />
      </div>

      <MonitoredSources />

      {incidents.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="space-y-3">
          {incidents.map((incident) => (
            <li key={incident.id}>
              <Link
                href={`/incidents/${incident.id}`}
                className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-slate-400">
                      {formatDay(incident.startedAt)} ·{" "}
                      {formatClock(incident.startedAt)} –{" "}
                      {formatClock(incident.endedAt)} ·{" "}
                      {incident.durationMinutes}m
                    </p>
                    <p className="mt-1 truncate font-mono text-sm text-slate-700">
                      {incident.site}
                    </p>
                    <h3 className="mt-1 font-semibold text-slate-900">
                      {incident.headline}
                    </h3>
                    <p className="mt-1 line-clamp-2 text-sm text-slate-500">
                      {incident.likelyCause}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <RiskBadge risk={incident.risk} score={incident.score} />
                    <span className="font-mono text-[11px] text-slate-400">
                      {incident.eventCount} events
                    </span>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {sites.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-slate-400">
            Connected sites
          </p>
          <ul className="mt-2 space-y-1">
            {sites.map((s) => (
              <li key={s.id} className="font-mono text-xs text-slate-600">
                {s.id} — {s.eventCount} events, {s.incidentCount} incidents,
                last seen {formatClock(s.lastSeenAt)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-slate-400">
        No tape recorded yet
      </p>
      <p className="mx-auto mt-2 max-w-lg text-sm text-slate-500">
        Nothing has been ingested for any site. Point a collector at{" "}
        <code className="rounded bg-slate-100 px-1 font-mono text-xs">
          POST /api/blackbox/ingest
        </code>
        , or load the reference compromise scenario to see the timeline and
        correlation output.
      </p>
    </div>
  );
}

function Denied({ hint }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-8">
      <h2 className="text-lg font-semibold text-slate-900">
        Authentication required
      </h2>
      <p className="mt-2 text-sm text-slate-500">{hint}</p>
    </div>
  );
}
