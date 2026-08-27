import Link from "next/link";
import { notFound } from "next/navigation";
import { getSiteById, getIncidentsBySite, getEventsBySite } from "@/lib/blackbox/storage";
import { connectionHealth } from "@/lib/blackbox/sites";
import { getSiteStats } from "@/lib/blackbox/dashboard";
import StatusDot from "@/app/components/blackbox/StatusDot";
import IncidentCard from "@/app/components/blackbox/IncidentCard";
import ConnectionPanel from "@/app/components/blackbox/ConnectionPanel";
import WebsiteEnvironment from "@/app/components/blackbox/WebsiteEnvironment";
import RecentActivity from "@/app/components/blackbox/RecentActivity";

export const dynamic = "force-dynamic";

export default async function WebsiteDetailPage({ params }) {
  const { id } = await params;

  const site = await getSiteById(id);
  if (!site) notFound();

  const [incidents, events] = await Promise.all([
    getIncidentsBySite(id, 100),
    getEventsBySite(id, 30),
  ]);

  const health = connectionHealth(site);
  const stats = await getSiteStats(id, incidents);

  return (
    <div className="space-y-8">
      <header>
        <Link href="/websites" className="text-sm text-slate-500 hover:text-slate-800">
          ← Websites
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{site.name}</h1>
          <StatusDot tone={health.tone} label={health.label} />
        </div>
        <p className="mt-1 text-sm text-slate-500">{site.host}</p>
      </header>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Summary label="Risk Score" value={`${stats.risk}/100`} />
        <Summary label="Open Incidents" value={stats.open} />
        <Summary label="Critical" value={stats.critical} />
        <Summary label="High" value={stats.high} />
        <Summary label="Last Event" value={stats.total ? ago(site.lastEventAt) : "—"} />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Incidents
        </h2>
        {incidents.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
            <p className="text-sm font-medium text-slate-900">
              We&apos;re receiving events from your website.
            </p>
            <p className="mt-1 text-sm text-slate-500">No incidents detected yet.</p>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {incidents.slice(0, 6).map((incident) => (
              <IncidentCard key={incident.id} incident={incident} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Recent Activity
        </h2>
        <RecentActivity events={events} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <ConnectionPanel site={site} health={health} />
        <WebsiteEnvironment site={site} />
      </div>
    </div>
  );
}

function Summary({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{value}</p>
    </div>
  );
}

function ago(ms) {
  if (!ms) return "never";
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.round(hours / 24)} days ago`;
}
