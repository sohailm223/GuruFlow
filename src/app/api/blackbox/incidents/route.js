import { json } from "../_lib";
import { getIncidents, getSites } from "@/lib/blackbox/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/blackbox/incidents
 *
 * Filters: ?site= &severity= &status= &category= &from= &to= &q=
 */
export async function GET(req) {
  const { searchParams } = new URL(req.url);

  const site = searchParams.get("site");
  const severity = searchParams.get("severity");
  const status = searchParams.get("status");
  const category = searchParams.get("category");
  const from = Number(searchParams.get("from")) || null;
  const to = Number(searchParams.get("to")) || null;
  const q = (searchParams.get("q") ?? "").trim().toLowerCase();

  let incidents = await getIncidents(500);

  if (site) incidents = incidents.filter((i) => i.siteId === site);
  if (severity) incidents = incidents.filter((i) => i.severity === severity);
  if (status) incidents = incidents.filter((i) => i.status === status);
  if (category) incidents = incidents.filter((i) => i.categories?.includes(category));
  if (from) incidents = incidents.filter((i) => i.startedAt >= from);
  if (to) incidents = incidents.filter((i) => i.startedAt <= to);

  if (q) {
    incidents = incidents.filter((i) => matches(i, q));
  }

  const sites = await getSites();

  return json({ incidents: incidents.slice(0, 200), sites, total: incidents.length });
}

/** Free-text search across incident text, plugins, themes, files, users, IPs. */
function matches(incident, q) {
  const haystack = [
    incident.title,
    incident.summary,
    incident.cause,
    ...(incident.actors ?? []).flatMap((a) => [a.username, ...(a.ips ?? [])]),
    ...(incident.ips ?? []),
    ...(incident.events ?? []).flatMap((e) => [
      e.text,
      e.type,
      e.path,
      e.target?.name,
      e.target?.plugin,
      e.target?.theme,
      e.target?.username,
      e.actor?.username,
      e.actor?.ip,
    ]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(q);
}
