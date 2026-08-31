import { getSites } from "@/lib/blackbox/storage";
import { connectionHealth, nowMs } from "@/lib/blackbox/sites";
import GlobalEventExplorer from "@/app/components/blackbox/GlobalEventExplorer";

export const dynamic = "force-dynamic";

/**
 * Raw event stream for every connected collector, with the full filter set:
 * website, category, event type, actor, incident, date and risk — plus free-text
 * search across username, path, plugin, theme, IP, event ID and cron hook.
 */
export default async function EventsPage() {
  const sitesRaw = await getSites();
  const now = nowMs();

  const sites = sitesRaw.map((site) => ({
    id: site.id,
    name: site.name,
    url: site.url,
    collector: connectionHealth(site, now),
  }));

  return <GlobalEventExplorer sites={sites} />;
}
