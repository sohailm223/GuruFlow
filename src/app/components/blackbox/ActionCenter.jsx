import Link from "next/link";
import { ArrowRight, ShieldAlert, TriangleAlert, CheckCircle2 } from "lucide-react";
import { timeAgo } from "@/lib/blackbox/sites";
import { shortChain } from "./IncidentCard";

/**
 * The "Action Center" — the top of the Overview.
 *
 * When something is wrong it names the affected website and shows the two next
 * actions; it never competes with stats for attention. When everything is fine
 * it is a calm one-liner.
 */
export default function ActionCenter({ top, topSite, now }) {
  if (!top) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-teal-50 text-teal-700">
            <CheckCircle2 size={20} />
          </span>
          <div>
            <h2 className="text-base font-semibold text-slate-900">All websites reporting normally</h2>
            <p className="text-sm text-slate-500">No open incidents need your attention right now.</p>
          </div>
        </div>
      </section>
    );
  }

  const critical = top.severity === "critical";
  const chain = shortChain(top);

  const tone = critical
    ? {
        wrap: "bg-gradient-to-br from-rose-950 via-rose-900 to-rose-800 text-rose-50",
        pill: "bg-rose-500/20 text-rose-200 ring-rose-300/30",
        primary: "bg-rose-500 text-white hover:bg-rose-400",
        secondary: "ring-white/25 text-rose-50 hover:bg-white/10",
        Icon: ShieldAlert,
        kicker: "Critical issue detected",
      }
    : {
        wrap: "bg-gradient-to-br from-amber-950 via-amber-900 to-amber-800 text-amber-50",
        pill: "bg-amber-500/20 text-amber-200 ring-amber-300/30",
        primary: "bg-amber-500 text-amber-950 hover:bg-amber-400",
        secondary: "ring-white/25 text-amber-50 hover:bg-white/10",
        Icon: TriangleAlert,
        kicker: "Needs your attention",
      };

  return (
    <section className={`relative overflow-hidden rounded-2xl ${tone.wrap} shadow-lg`}>
      <div className="relative z-10 p-6 sm:p-7">
        <span
          className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ring-1 ring-inset ${tone.pill}`}
        >
          <tone.Icon size={13} />
          {tone.kicker}
        </span>

        <h2 className="mt-4 text-2xl font-semibold tracking-tight text-white">
          {topSite?.name ?? "A website"} may be compromised
        </h2>

        {chain && (
          <p className="mt-2 truncate font-mono text-sm text-white/70">{chain}</p>
        )}

        <p className="mt-3 text-sm text-white/70">
          Risk <strong className="text-white">{top.riskScore}/100</strong>
          {" · "}
          {top.eventCount} event{top.eventCount === 1 ? "" : "s"}
          {" · "}
          {timeAgo(top.startedAt, now)}
        </p>

        <div className="mt-5 flex flex-wrap gap-2.5">
          <Link
            href={`/incidents/${top.id}`}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${tone.primary}`}
          >
            Investigate Incident
            <ArrowRight size={15} />
          </Link>
          {topSite && (
            <Link
              href={`/websites/${topSite.id}`}
              className={`inline-flex items-center rounded-lg px-4 py-2 text-sm font-semibold ring-1 ring-inset transition ${tone.secondary}`}
            >
              View Website
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
