import Link from "next/link";

/**
 * Dashboard status panel.
 *
 * A server component: every value is computed by getOverview(), so nothing here
 * reads the clock during render.
 */
export default function HeroPanel({ counts, activity, now }) {
  const verdict = summarise(counts);

  const tiles = [
    { key: "Events today", value: fmt(activity?.eventsToday), hint: `${fmt(activity?.totalEvents)} all time` },
    { key: "Last event", value: ago(activity?.lastEventAt, now), hint: "From any website" },
    { key: "Open incidents", value: fmt(activity?.openIncidents), hint: "Awaiting review", warn: (activity?.openIncidents ?? 0) > 0 },
    { key: "Connected", value: `${fmt(counts?.healthy)} / ${fmt(counts?.connected)}`, hint: "Healthy / total" },
  ];

  return (
    <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-teal-950 to-teal-800 text-slate-100 shadow-xl shadow-slate-900/20">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(620px_220px_at_88%_-20%,rgba(45,212,191,0.28),transparent_70%)]"
      />

      <div className="relative z-10 p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <span
              className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider ${verdict.pill}`}
            >
              <span aria-hidden="true" className="block h-2 w-2 rounded-full bg-current" />
              {verdict.label}
            </span>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              {verdict.headline}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-300">{verdict.detail}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href="/websites/add"
              className="rounded-lg bg-teal-400 px-4 py-2 text-sm font-semibold text-teal-950 transition hover:bg-teal-300"
            >
              Add Website
            </Link>
            <Link
              href="/incidents"
              className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-100 ring-1 ring-inset ring-white/25 transition hover:bg-white/10"
            >
              View Incidents
            </Link>
          </div>
        </div>

        <dl className="mt-7 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          {tiles.map((t) => (
            <div
              key={t.key}
              className="rounded-xl bg-white/[0.07] p-3.5 ring-1 ring-inset ring-white/10"
            >
              <dt className="text-[11px] font-medium uppercase tracking-wider text-teal-300">{t.key}</dt>
              <dd className={`mt-1.5 text-xl font-bold tabular-nums ${t.warn ? "text-rose-300" : "text-white"}`}>
                {t.value}
              </dd>
              <dd className="mt-0.5 truncate text-[11px] text-slate-400">{t.hint}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function summarise(counts) {
  const c = counts ?? { connected: 0, healthy: 0, needsAttention: 0, critical: 0 };

  if (c.connected === 0) {
    return {
      label: "Getting started",
      pill: "bg-slate-400/20 text-slate-200 ring-1 ring-inset ring-white/20",
      headline: "No websites connected yet",
      detail:
        "Add your WordPress site, install the ScanSite collector and paste the pairing code. Events start flowing within a minute.",
    };
  }

  if (c.critical > 0) {
    return {
      label: "Critical",
      pill: "bg-rose-500/20 text-rose-200 ring-1 ring-inset ring-rose-300/30",
      headline: `${c.critical} website${c.critical === 1 ? "" : "s"} with a critical incident`,
      detail:
        "Open the incident to see the causal chain, the events that prove each step, and what to do first.",
    };
  }

  if (c.needsAttention > 0) {
    return {
      label: "Needs attention",
      pill: "bg-amber-500/20 text-amber-200 ring-1 ring-inset ring-amber-300/30",
      headline: `${c.needsAttention} website${c.needsAttention === 1 ? "" : "s"} need attention`,
      detail: "The collector has stopped reporting, or a recent incident is still open.",
    };
  }

  return {
    label: "All clear",
    pill: "bg-teal-400/20 text-teal-200 ring-1 ring-inset ring-teal-300/30",
    headline: "All websites reporting normally",
    detail:
      "Every connected collector is sending events and no critical incidents are open. New activity appears here automatically.",
  };
}

function fmt(n) {
  return typeof n === "number" ? n.toLocaleString("en-US") : "0";
}

/** Relative age of a timestamp, measured against a caller-supplied reference time. */
function ago(ts, now) {
  if (!ts || !now) return "None yet";
  const mins = Math.round((now - ts) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.round(hours / 24)} days ago`;
}
