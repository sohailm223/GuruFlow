import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getSites } from "@/lib/blackbox/storage";
import { connectionHealth, timeAgo, nowMs } from "@/lib/blackbox/sites";

export const dynamic = "force-dynamic";

const TONE = { connected: "text-emerald-400", stale: "text-amber-400", offline: "text-rose-400", never: "text-slate-500" };

export default async function ConnectionPage() {
  const sites = await getSites();
  const now = nowMs();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-100">Connection</h1>
        <p className="mt-1 text-sm text-slate-500">Collector pairing and check-in health for every website.</p>
      </div>
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60">
        <div className="divide-y divide-slate-800/60">
          {sites.length === 0 ? (
            <p className="p-5 text-sm text-slate-500">No websites connected yet.</p>
          ) : (
            sites.map((s) => {
              const c = connectionHealth(s, now);
              return (
                <Link key={s.id} href={`/websites/${s.id}`} className="flex items-center justify-between p-4 hover:bg-slate-900/40">
                  <div>
                    <p className="text-sm font-medium text-slate-200">{s.name}</p>
                    <p className="text-xs text-slate-500">{s.url}</p>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span className={`capitalize ${TONE[c.key] ?? "text-slate-400"}`}>{c.key}</span>
                    <span className="text-xs text-slate-500">{timeAgo(s.lastSeenAt, now)}</span>
                    <ArrowRight size={15} className="text-slate-500" />
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
