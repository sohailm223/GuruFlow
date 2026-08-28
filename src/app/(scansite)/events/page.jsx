import Link from "next/link";
import { getEvents, getSites } from "@/lib/blackbox/storage";
import { timeAgo, nowMs } from "@/lib/blackbox/sites";
import { formatClock } from "@/lib/blackbox/schemas";

export const dynamic = "force-dynamic";

const SEV_TONE = {
  critical: "bg-rose-500/10 text-rose-400",
  high: "bg-orange-500/10 text-orange-400",
  medium: "bg-amber-500/10 text-amber-400",
  low: "bg-slate-500/10 text-slate-400",
  info: "bg-slate-500/10 text-slate-400",
};

export default async function EventsPage() {
  const [events, sites] = await Promise.all([getEvents(300), getSites()]);
  const now = nowMs();
  const siteName = (id) => sites.find((s) => s.id === id)?.name ?? id;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-100">Events</h1>
        <p className="mt-1 text-sm text-slate-500">The raw security event stream from every connected collector.</p>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60">
        <div className="divide-y divide-slate-800/60">
          {events.length === 0 ? (
            <p className="p-5 text-sm text-slate-500">No events yet. Events appear as soon as a collector reports.</p>
          ) : (
            events.map((e) => (
              <div key={e.id} className="flex items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${(SEV_TONE[e.severity] ?? SEV_TONE.info)}`}>
                      {(e.severity ?? "info").toUpperCase()}
                    </span>
                    <span className="font-mono text-xs text-slate-500">{e.type}</span>
                  </div>
                  <p className="mt-1 text-sm text-slate-200">{e.title ?? e.type}</p>
                  <p className="text-xs text-slate-500">{siteName(e.siteId)}</p>
                </div>
                <div className="shrink-0 text-right text-xs text-slate-500">
                  <p>{timeAgo(e.at, now)}</p>
                  <p>{formatClock(e.at)}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <p className="text-xs text-slate-500">
        Looking for a specific site&apos;s activity? Open it from{" "}
        <Link href="/websites" className="text-teal-400 hover:underline">Websites</Link>.
      </p>
    </div>
  );
}
