import RiskBadge from "./RiskBadge";

const RAIL_DOT = {
  CRITICAL: "bg-rose-500",
  HIGH: "bg-orange-500",
  MEDIUM: "bg-amber-500",
  LOW: "bg-sky-500",
  INFO: "bg-slate-400",
};

function riskForScore(score) {
  if (score >= 40) return "CRITICAL";
  if (score >= 25) return "HIGH";
  if (score >= 12) return "MEDIUM";
  if (score >= 5) return "LOW";
  return "INFO";
}

/**
 * The "CCTV tape": chronological readout of everything that happened,
 * with the suspicious entries visually escalated.
 */
export default function IncidentTimeline({ incident, formatTime, formatGap }) {
  const timeline = incident.timeline ?? [];

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-slate-950 text-slate-100 shadow-sm">
      {/* Header bar */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-slate-900 px-5 py-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-slate-400">
            Website Incident
          </p>
          <p className="mt-1 font-mono text-sm text-slate-100">{incident.site}</p>
        </div>
        <RiskBadge risk={incident.risk} score={incident.score} size="lg" />
      </header>

      {/* Tape */}
      <div className="px-5 py-5">
        <p className="mb-4 border-b border-dashed border-white/15 pb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-slate-500">
          {incident.eventCount} events · {incident.durationMinutes} minute window
        </p>

        <ol className="relative space-y-0">
          {timeline.map((entry, i) => {
            const level = riskForScore(entry.score ?? 0);
            const isLast = i === timeline.length - 1;
            const suspicious = (entry.score ?? 0) >= 12;

            return (
              <li key={`${entry.at}-${i}`} className="flex gap-4">
                {/* gutter: time + rail */}
                <div className="flex w-[92px] shrink-0 flex-col items-end">
                  <span
                    className={`font-mono text-xs tabular-nums ${
                      suspicious ? "text-rose-300" : "text-slate-400"
                    }`}
                  >
                    {formatTime(entry.at)}
                  </span>
                  <span className="mt-1 font-mono text-[10px] uppercase tracking-wider text-slate-600">
                    {entry.category}
                  </span>
                </div>

                <div className="relative flex w-5 shrink-0 justify-center">
                  {!isLast && (
                    <span className="absolute top-3 bottom-0 w-px bg-white/15" />
                  )}
                  <span
                    className={`relative mt-1 h-2.5 w-2.5 shrink-0 rounded-full ring-4 ring-slate-950 ${
                      RAIL_DOT[level] ?? RAIL_DOT.INFO
                    }`}
                  />
                </div>

                {/* body */}
                <div className="min-w-0 flex-1 pb-5">
                  <p
                    className={`font-mono text-sm leading-relaxed ${
                      suspicious ? "text-slate-50" : "text-slate-300"
                    }`}
                  >
                    {entry.text}
                  </p>

                  {entry.path && (
                    <p className="mt-1 truncate font-mono text-xs text-slate-500">
                      {entry.path}
                    </p>
                  )}

                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-slate-500">
                    {entry.actor?.name && <span>actor: {entry.actor.name}</span>}
                    {(entry.sourceIp || entry.actor?.ip) && (
                      <span>ip: {entry.sourceIp || entry.actor.ip}</span>
                    )}
                    {entry.score > 0 && (
                      <span className="text-slate-600">+{entry.score}</span>
                    )}
                    {!isLast && timeline[i + 1] && (
                      <span className="text-slate-700">
                        {formatGap(entry.at, timeline[i + 1].at)}
                      </span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
