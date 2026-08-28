import { notFound } from "next/navigation";
import { getSiteById } from "@/lib/blackbox/storage";
import { connectionHealth } from "@/lib/blackbox/sites";
import EventExplorer from "@/app/components/blackbox/EventExplorer";

export const dynamic = "force-dynamic";

/**
 * /websites/[id]/events — Raw Event Explorer.
 *
 * Deliberately separate from the incident views: this is the debugging surface
 * for "what is the collector actually sending", not the customer-facing story.
 */
export default async function WebsiteEventsPage({ params }) {
  const { id } = await params;

  const site = await getSiteById(id);
  if (!site) notFound();

  const health = connectionHealth(site);

  return (
    <EventExplorer
      siteId={site.id}
      siteName={site.name}
      host={site.host}
      health={{ label: health.label, tone: health.tone }}
    />
  );
}
