import Link from "next/link";
import { Plus, MonitorSmartphone, TriangleAlert, ShieldAlert, PlugZap, FileWarning } from "lucide-react";
import { getOverview } from "@/lib/blackbox/dashboard";
import FirstRun from "@/app/components/blackbox/FirstRun";
import ActionCenter from "@/app/components/blackbox/ActionCenter";
import NeedsAttention from "@/app/components/blackbox/NeedsAttention";
import SiteHealthTable from "@/app/components/blackbox/SiteHealthTable";
import RecentActivityFeed from "@/app/components/blackbox/RecentActivityFeed";
import IncidentCard from "@/app/components/blackbox/IncidentCard";

export const dynamic = "force-dynamic";

function OperationalStats({ counts }) {
  const tiles = [
    {
      label: "Sites monitored",
      value: counts.sitesMonitored,
      icon: MonitorSmartphone,
      tone: "bg-sky-50 text-sky-700",
    },
    {
      label: "Need attention",
      value: counts.needAttention,
      icon: TriangleAlert,
      tone: counts.needAttention ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-500",
    },
    {
      label: "Open incidents",
      value: counts.openIncidents,
      icon: ShieldAlert,
      tone: counts.openIncidents ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-500",
    },
    {
      label: "Collector issues",
      value: counts.collectorIssues,
      icon: PlugZap,
      tone: counts.collectorIssues ? "bg-violet-50 text-violet-700" : "bg-slate-100 text-slate-500",
    },
    {
      label: "Suspicious files",
      value: counts.suspiciousFiles ?? 0,
      icon: FileWarning,
      tone: counts.suspiciousFiles ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-500",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className={`inline-flex rounded-lg p-2 ${t.tone}`}>
            <t.icon size={18} />
          </div>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">{t.value}</p>
          <p className="text-sm text-slate-500">{t.label}</p>
        </div>
      ))}
    </div>
  );
}

function FileSecurity({ sites }) {
  const tot = sites.reduce(
    (a, s) => ({
      checked: a.checked + (s.fileStats?.checked ?? 0),
      critical: a.critical + (s.fileStats?.critical ?? 0),
      suspicious: a.suspicious + (s.fileStats?.suspicious ?? 0),
    }),
    { checked: 0, critical: 0, suspicious: 0 },
  );
  if (!tot.checked) return null;

  const target = sites.find((s) => s.fileStats?.checked)?.site;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-wide text-slate-700 uppercase">File security</h2>
        {target && (
          <Link href={`/websites/${target.id}/files`} className="text-xs font-semibold text-rose-700 hover:text-rose-800">
            View File Integrity →
          </Link>
        )}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div>
          <p className="text-2xl font-semibold text-slate-900">{tot.checked.toLocaleString()}</p>
          <p className="text-sm text-slate-500">Files checked</p>
        </div>
        <div>
          <p className="text-2xl font-semibold text-teal-700">{Math.max(0, tot.checked - tot.suspicious - tot.critical).toLocaleString()}</p>
          <p className="text-sm text-slate-500">Verified</p>
        </div>
        <div>
          <p className="text-2xl font-semibold text-amber-700">{tot.suspicious}</p>
          <p className="text-sm text-slate-500">Suspicious</p>
        </div>
        <div>
          <p className="text-2xl font-semibold text-rose-700">{tot.critical}</p>
          <p className="text-sm text-slate-500">Critical</p>
        </div>
      </div>
      {tot.critical > 0 && (
        <p className="mt-3 text-sm text-rose-700">
          {tot.critical} critical file{tot.critical === 1 ? "" : "s"} need inspection.
        </p>
      )}
    </section>
  );
}

export default async function OverviewPage() {
  const ov = await getOverview();
  const { sites, needsAttention, priorityIncidents, routineIncidents, recentActivity, counts, now } =
    ov;

  if (!sites.length) {
    return <FirstRun />;
  }

  const siteById = new Map(sites.map((s) => [s.site.id, s.site]));
  const incidentCards = priorityIncidents.slice(0, 4);

  return (
    <div className="space-y-6">
      {/* Greeting + primary action */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            {ov.greeting}, here&apos;s what needs attention
          </h1>
          <p className="text-sm text-slate-500">{ov.subtitle}</p>
        </div>
        <Link
          href="/websites/add"
          className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
        >
          <Plus size={16} /> Add Website
        </Link>
      </header>

      {/* Action center — names the most urgent thing and the next step */}
      <ActionCenter top={ov.top} topSite={ov.topSite} now={now} />

      <OperationalStats counts={counts} />

      <FileSecurity sites={sites} />

      <NeedsAttention items={needsAttention} />

      <SiteHealthTable sites={sites} now={now} />

      {incidentCards.length > 0 && (
        <section className="space-y-3">
          <header className="flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-wide text-slate-700 uppercase">
              Recent incidents
            </h2>
            <Link href="/incidents" className="text-xs font-semibold text-rose-700 hover:text-rose-800">
              View all →
            </Link>
          </header>
          <div className="grid gap-4 lg:grid-cols-2">
            {incidentCards.map((incident) => (
              <IncidentCard
                key={incident.id}
                incident={incident}
                siteName={siteById.get(incident.siteId)?.name}
                now={now}
              />
            ))}
          </div>
        </section>
      )}

      <RecentActivityFeed
        activity={recentActivity}
        routineIncidents={routineIncidents}
        now={now}
      />

      <p className="text-center text-xs text-slate-400">
        {counts.sitesMonitored} monitored · {recentActivity.length ? recentActivity[0].time : "no events yet"}
      </p>
    </div>
  );
}
