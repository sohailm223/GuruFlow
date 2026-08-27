import Link from "next/link";
import SetPageTitle from "@/app/components/common/SetPageTitle";
import IncidentTimeline from "@/app/components/blackbox/IncidentTimeline";
import LikelyCause from "@/app/components/blackbox/LikelyCause";
import MonitoredSources from "@/app/components/blackbox/MonitoredSources";
import { assertBlackboxAccess } from "@/lib/incidents/access";
import { getIncident } from "@/lib/incidents/store";
import { formatClock, formatDay, gapLabel } from "@/lib/incidents/narrative";

export const dynamic = "force-dynamic";

export default async function IncidentDetailPage({ params }) {
  const denied = await assertBlackboxAccess();
  const { id } = await params;

  if (denied) return <Denied hint={denied.body.hint} />;

  const incident = await getIncident(id);
  if (!incident) return <NotFound id={id} />;

  const formatTime = (ms) => formatClock(ms);

  return (
    <div className="space-y-6">
      <SetPageTitle title={`Incident: ${incident.headline}`} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/incidents"
          className="font-mono text-xs text-slate-500 hover:text-slate-900"
        >
          ← All incidents
        </Link>
        <p className="font-mono text-xs text-slate-400">
          {formatDay(incident.startedAt)} · {formatClock(incident.startedAt)} –{" "}
          {formatClock(incident.endedAt)} · {incident.id}
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <IncidentTimeline
          incident={incident}
          formatTime={formatTime}
          formatGap={gapLabel}
        />

        <div className="space-y-6">
          <LikelyCause incident={incident} formatTime={formatTime} />
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <MonitoredSources active={incident.categories} />
          </div>
        </div>
      </div>
    </div>
  );
}

function NotFound({ id }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-8">
      <h2 className="text-lg font-semibold text-slate-900">Incident not found</h2>
      <p className="mt-2 font-mono text-sm text-slate-500">{id}</p>
      <Link
        href="/incidents"
        className="mt-4 inline-block font-mono text-xs text-blue-600 hover:underline"
      >
        ← Back to all incidents
      </Link>
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
