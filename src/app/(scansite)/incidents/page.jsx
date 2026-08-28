import { Suspense } from "react";
import Link from "next/link";
import { getIncidents, getSites } from "@/lib/blackbox/storage";
import IncidentCard from "@/app/components/blackbox/IncidentCard";
import IncidentFilters from "@/app/components/blackbox/IncidentFilters";

export const dynamic = "force-dynamic";

export default async function IncidentsPage({ searchParams }) {
  const sp = await searchParams;
  const [allIncidents, sites] = await Promise.all([getIncidents(500), getSites()]);
  const siteNames = new Map(sites.map((s) => [s.id, s.name]));

  const incidents = applyFilters(allIncidents, sp);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100">Black Box</h1>
        <p className="mt-1 text-sm text-slate-500">
          Understand exactly what changed, what broke and what probably caused it.
        </p>
      </header>

      <Suspense fallback={null}>
        <IncidentFilters sites={sites} />
      </Suspense>

      {incidents.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
          <h2 className="text-lg font-semibold text-slate-100">No incidents found</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
            {allIncidents.length === 0 ? (
              <>
                Nothing has been recorded yet.{" "}
                <Link href="/websites/add" className="font-medium text-teal-700 hover:underline">
                  Connect a WordPress website
                </Link>{" "}
                to start collecting events.
              </>
            ) : (
              "No incidents match the current filters."
            )}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {incidents.map((incident) => (
            <IncidentCard
              key={incident.id}
              incident={incident}
              siteName={siteNames.get(incident.siteId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The same filtering the API exposes, applied here so the page renders
 * correctly on the server without a client round-trip.
 */
function applyFilters(incidents, sp) {
  const q = (sp.q ?? "").trim().toLowerCase();
  const from = Number(sp.from) || null;

  return incidents.filter((incident) => {
    if (sp.site && incident.siteId !== sp.site) return false;
    if (sp.severity && incident.severity !== sp.severity) return false;
    if (sp.status && incident.status !== sp.status) return false;
    if (sp.category && !incident.categories?.includes(sp.category)) return false;
    if (from && incident.startedAt < from) return false;

    if (q) {
      const haystack = [
        incident.title,
        incident.summary,
        incident.cause,
        ...(incident.actors ?? []).flatMap((a) => [a.username, ...(a.ips ?? [])]),
        ...(incident.events ?? []).flatMap((e) => [
          e.text,
          e.path,
          e.target?.name,
          e.target?.plugin,
          e.target?.username,
          e.actor?.username,
          e.actor?.ip,
        ]),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      if (!haystack.includes(q)) return false;
    }

    return true;
  });
}
