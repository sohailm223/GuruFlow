import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getSites } from "@/lib/blackbox/storage";

export const dynamic = "force-dynamic";

const TONE = { production: "text-emerald-400", staging: "text-amber-400", development: "text-sky-400" };

export default async function EnvironmentPage() {
  const sites = await getSites();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-100">Environment</h1>
        <p className="mt-1 text-sm text-slate-500">Which environment each connected WordPress site runs in.</p>
      </div>
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60">
        <div className="divide-y divide-slate-800/60">
          {sites.length === 0 ? (
            <p className="p-5 text-sm text-slate-500">No websites yet.</p>
          ) : (
            sites.map((s) => (
              <Link key={s.id} href={`/websites/${s.id}`} className="flex items-center justify-between p-4 hover:bg-slate-900/40">
                <div>
                  <p className="text-sm font-medium text-slate-200">{s.name}</p>
                  <p className="text-xs text-slate-500">{s.url}</p>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className={`capitalize ${TONE[s.environment] ?? "text-slate-400"}`}>{s.environment}</span>
                  <ArrowRight size={15} className="text-slate-500" />
                </div>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
