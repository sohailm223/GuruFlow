import { notFound } from "next/navigation";
import { getSiteById, getIncidentsBySite } from "@/lib/blackbox/storage";
import { connectionHealth } from "@/lib/blackbox/sites";
import EventExplorer from "@/app/components/blackbox/EventExplorer";

export const dynamic = "force-dynamic";

/**
 * /websites/[id]/events — Raw Event Explorer.
 *
 * Deliberately separate from the incident views: this is the debugging surface
 * for "what is the collector actually sending", not the customer-facing story.
 *
 * Query params seed the filters, so an incident can deep-link straight to its
 * own events: /websites/<id>/events?incident=<incidentId>
 */
export default async function WebsiteEventsPage({ params, searchParams }) {
  const { id } = await params;
  const query = await searchParams;

  const site = await getSiteById(id);
  if (!site) notFound();

  const [health, incidents] = await Promise.all([
    Promise.resolve(connectionHealth(site)),
    getIncidentsBySite(id, 100),
  ]);

  // Only the filters the Explorer understands are passed through.
  const initialFilters = {};
  for (const key of ["category", "type", "actor", "q", "incident", "date"]) {
    if (typeof query[key] === "string" && query[key]) initialFilters[key] = query[key];
  }

  return (
    <EventExplorer
      siteId={site.id}
      siteName={site.name}
      host={site.host}
      health={{ label: health.label, tone: health.tone }}
      initialFilters={initialFilters}
      initialIncidents={incidents.map((i) => ({ id: i.id, title: i.title, severity: i.severity }))}
    />
  );
}
