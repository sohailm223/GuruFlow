import Link from "next/link";
import { getSites, getIncidentsBySite } from "@/lib/blackbox/storage";
import { connectionHealth } from "@/lib/blackbox/sites";
import { getSiteStats } from "@/lib/blackbox/dashboard";
import WebsiteCard from "@/app/components/blackbox/WebsiteCard";

export const dynamic = "force-dynamic";

export default async function WebsitesPage() {
  const sites = await getSites();

  const cards = [];
  for (const site of sites) {
    const incidents = await getIncidentsBySite(site.id, 100);
    cards.push({
      site,
      // connectionHealth reads the clock itself; doing it here would make the
      // render impure under react-hooks/purity.
      health: connectionHealth(site),
      stats: await getSiteStats(site.id, incidents),
    });
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Websites</h1>
          <p className="mt-1 text-sm text-slate-500">
            Monitor every WordPress website from one place.
          </p>
        </div>
        <Link
          href="/websites/add"
          className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-teal-800"
        >
          + Add Website
        </Link>
      </header>

      {cards.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
          <h2 className="text-lg font-semibold text-slate-900">No websites connected yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
            Connect a WordPress website to start recording what changes on it.
          </p>
          <Link
            href="/websites/add"
            className="mt-5 inline-block rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800"
          >
            + Add Website
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map(({ site, health, stats }) => (
            <WebsiteCard key={site.id} site={site} health={health} stats={stats} />
          ))}
        </div>
      )}
    </div>
  );
}
