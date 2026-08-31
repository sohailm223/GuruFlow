import { correlationKeys } from "@/lib/blackbox/correlation";

/**
 * Development-only diagnostics.
 *
 * Rendered only when NODE_ENV is "development" (the caller gates it). Every
 * number here is derived from the stored incident and the same scoring engine
 * that produced it — nothing is recomputed with different rules, so what you see
 * is what the analysis actually did.
 *
 * Grouping score is defined explicitly, because "grouping score" is not a stored
 * field: it is the share of events in this incident that are linked to another
 * event by identity (actor / IP / session / account / plugin / theme / hook /
 * file path) rather than by timing alone. 100% means every event was
 * identity-linked; 0% means the incident was formed purely by the time gap.
 */

const GAP_MINUTES = 10; // mirrors GROUPING_DEFAULTS.gapMinutes

export default function DevDiagnostics({ incident }) {
  const events = [...(incident.events ?? [])].sort((a, b) => a.timestamp - b.timestamp);
  const clusters = incident.correlationClusters ?? [];
  const linked = clusters.reduce((n, c) => n + (c.eventCount ?? 0), 0);
  const total = incident.eventCount ?? events.length ?? 0;
  const groupingScore = total ? Math.round((Math.min(linked, total) / total) * 100) : 0;

  const gaps = events.slice(1).map((e, i) => ({
    from: events[i].type,
    to: e.type,
    minutes: Math.round(((e.timestamp - events[i].timestamp) / 60_000) * 10) / 10,
  }));
  const maxGap = gaps.length ? Math.max(...gaps.map((g) => g.minutes)) : 0;

  const keys = new Set();
  for (const c of clusters) for (const k of c.keys ?? []) keys.add(k);
  const perEventKeys = events.map((e) => ({
    eventId: e.eventId,
    type: e.type,
    score: e.score ?? 0,
    keys: correlationKeys(e),
  }));

  const findings = incident.findings ?? [];
  const patternWeight = findings.reduce((s, f) => s + (f.weight ?? 0), 0);
  const lift = 1 + Math.min(patternWeight, 60) / 400;

  return (
    <section className="rounded-xl border-2 border-dashed border-amber-400/60 bg-amber-50 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-800">
          Developer diagnostics
        </h2>
        <span className="rounded bg-amber-200/70 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-900">
          development only
        </span>
      </div>

      <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Grouping score" value={`${groupingScore}%`} hint={`${Math.min(linked, total)}/${total} events identity-linked`} />
        <Metric
          label="Raw event score"
          value={String(incident.rawScore ?? 0)}
          hint={`risk ${incident.riskScore}/100 after pattern lift ×${lift.toFixed(3)}`}
        />
        <Metric label="Max time distance" value={`${maxGap} min`} hint={`grouping gap is ${GAP_MINUTES} min`} />
        <Metric label="Duration" value={`${incident.durationMinutes ?? 0} min`} hint={`${total} events`} />
      </dl>

      <div className="mt-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Correlation keys</p>
        {keys.size === 0 ? (
          <p className="mt-1 text-sm text-amber-900/80">
            None — this incident was grouped by time alone, so the time fallback applied.
          </p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {[...keys].map((k) => (
              <li key={k} className="rounded bg-white px-2 py-1 font-mono text-xs text-amber-900 ring-1 ring-inset ring-amber-300">
                {k}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Detector contributions</p>
        {findings.length === 0 ? (
          <p className="mt-1 text-sm text-amber-900/80">No detector matched this window.</p>
        ) : (
          <table className="mt-2 w-full text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-amber-800/80">
                <th className="pb-1 font-medium">Detector</th>
                <th className="pb-1 font-medium">Weight</th>
                <th className="pb-1 font-medium">Share of pattern weight</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-amber-200">
              {findings.map((f) => (
                <tr key={f.id}>
                  <td className="py-1.5 text-amber-900">
                    {f.title}
                    <span className="ml-2 font-mono text-xs text-amber-800/70">{f.id}</span>
                  </td>
                  <td className="py-1.5 font-mono text-amber-900">{f.weight}</td>
                  <td className="py-1.5 font-mono text-amber-900">
                    {patternWeight ? `${Math.round(((f.weight ?? 0) / patternWeight) * 100)}%` : "—"}
                  </td>
                </tr>
              ))}
              <tr>
                <td className="py-1.5 font-semibold text-amber-900">Total pattern weight</td>
                <td className="py-1.5 font-mono font-semibold text-amber-900">{patternWeight}</td>
                <td className="py-1.5 font-mono text-amber-900">capped at 60 for the lift</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      <div className="mt-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
          Per-event score, keys and time distance
        </p>
        <table className="mt-2 w-full text-left text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-amber-800/80">
              <th className="pb-1 font-medium">Event</th>
              <th className="pb-1 font-medium">Score</th>
              <th className="pb-1 font-medium">Δ from previous</th>
              <th className="pb-1 font-medium">Correlation keys</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-amber-200">
            {perEventKeys.map((row, i) => (
              <tr key={row.eventId ?? i}>
                <td className="py-1.5 text-amber-900">
                  <span className="font-mono text-xs">{row.type}</span>
                  <span className="ml-2 font-mono text-[10px] text-amber-800/70">{row.eventId}</span>
                </td>
                <td className="py-1.5 font-mono text-amber-900">{row.score}</td>
                <td className="py-1.5 font-mono text-amber-900">
                  {i === 0 ? "—" : `${gaps[i - 1]?.minutes ?? 0} min`}
                </td>
                <td className="py-1.5 font-mono text-xs text-amber-900">
                  {row.keys.length ? row.keys.join(", ") : "none"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Metric({ label, value, hint }) {
  return (
    <div className="rounded-lg bg-white p-3 ring-1 ring-inset ring-amber-200">
      <p className="text-[11px] uppercase tracking-wide text-amber-800/80">{label}</p>
      <p className="mt-1 text-xl font-semibold text-amber-900">{value}</p>
      <p className="text-xs text-amber-800/70">{hint}</p>
    </div>
  );
}
