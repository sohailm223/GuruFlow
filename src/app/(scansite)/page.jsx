import Link from "next/link";
import { getOverview } from "@/lib/blackbox/dashboard";
import StatusDot from "@/app/components/blackbox/StatusDot";
import IncidentCard from "@/app/components/blackbox/IncidentCard";
import DemoLoader from "@/app/components/blackbox/DemoLoader";
import HeroPanel from "@/app/components/blackbox/HeroPanel";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const { sites, incidents, counts, activity } = await getOverview();
  const siteNames = new Map(sites.map((s) => [s.site.id, s.site.name]));

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Overview</h1>
      </header>

      <HeroPanel counts={counts} activity={activity} now={activity.now} />

      {sites.length === 0 ? (
        <FirstRun />
      ) : (
        <>

          <section>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Recent Incidents
              </h2>
              <Link href="/incidents" className="text-sm font-medium text-teal-700 hover:underline">
                View all
              </Link>
            </div>

            {incidents.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
                <p className="text-sm font-medium text-slate-900">
                  We&apos;re receiving events from your website.
                </p>
                <p className="mt-1 text-sm text-slate-500">No incidents detected yet.</p>
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {incidents.slice(0, 4).map((incident) => (
                  <IncidentCard
                    key={incident.id}
                    incident={incident}
                    siteName={siteNames.get(incident.siteId)}
                  />
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Website Connection Health
            </h2>
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
              {sites.map(({ site, health }) => (
                <li key={site.id} className="flex items-center justify-between gap-4 px-5 py-3">
                  <Link
                    href={`/websites/${site.id}`}
                    className="min-w-0 truncate text-sm font-medium text-slate-800 hover:text-teal-700"
                  >
                    {site.name}
                  </Link>
                  <StatusDot tone={health.tone} label={health.label} />
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {process.env.NODE_ENV === "development" && (
        <section className="rounded-xl border border-dashed border-slate-300 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-slate-900">Development</p>
              <p className="mt-1 text-sm text-slate-500">
                Generate demo incidents without connecting a real website.
              </p>
            </div>
            <DemoLoader />
          </div>
        </section>
      )}
    </div>
  );
}

function FirstRun() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
      <h2 className="text-xl font-semibold text-slate-900">
        Connect Your First WordPress Website
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-500">
        ScanSite Black Box monitors important WordPress changes and explains what
        happened when something goes wrong.
      </p>
      <Link
        href="/websites/add"
        className="mt-6 inline-block rounded-lg bg-teal-700 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-teal-800"
      >
        Connect WordPress Website
      </Link>
    </div>
  );
}
