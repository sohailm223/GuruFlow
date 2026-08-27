import RiskBadge from "./RiskBadge";

/**
 * The answer to "what happened?" — headline, likely cause and the evidence
 * chain that produced it, styled like the console readout in the brief.
 */
export default function LikelyCause({ incident, formatTime }) {
  const findings = incident.findings ?? [];

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-dashed border-slate-300 pb-3">
        <h2 className="font-mono text-xs uppercase tracking-[0.25em] text-slate-500">
          Likely Cause
        </h2>
        <RiskBadge risk={incident.risk} score={incident.score} />
      </div>

      <h3 className="mt-4 text-lg font-semibold text-slate-900">
        {incident.headline}
      </h3>

      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        {incident.likelyCause}
      </p>

      {findings.length > 1 && (
        <div className="mt-5">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-slate-400">
            Also detected
          </p>
          <ul className="mt-2 space-y-2">
            {findings.slice(1).map((f) => (
              <li key={f.id} className="text-sm text-slate-600">
                <span className="font-medium text-slate-800">{f.headline}</span>
                <span className="text-slate-400"> — </span>
                {f.cause}
              </li>
            ))}
          </ul>
        </div>
      )}

      {incident.timeline?.length > 0 && (
        <div className="mt-5 rounded-lg bg-slate-50 p-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-slate-500">
            Evidence chain
          </p>
          <ol className="mt-2 space-y-1">
            {(incident.findings?.[0]
              ? incident.timeline.filter((t) => t.score >= 12)
              : incident.timeline
            )
              .slice(0, 6)
              .map((t, i) => (
                <li key={i} className="font-mono text-xs text-slate-600">
                  <span className="text-slate-400">{formatTime(t.at)}</span>{" "}
                  {t.text}
                </li>
              ))}
          </ol>
        </div>
      )}
    </section>
  );
}
