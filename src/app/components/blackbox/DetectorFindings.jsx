/**
 * Which detectors fired, strongest first. Shown in the technical section so
 * the verdict can be audited without leading with it.
 */
export default function DetectorFindings({ incident }) {
  const findings = incident.findings ?? [];
  if (!findings.length) return null;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        Detectors
      </h2>

      <ul className="mt-4 divide-y divide-slate-100">
        {findings.map((f) => (
          <li key={f.id} className="py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-slate-800">{f.title}</p>
              <span className="font-mono text-xs text-slate-400">weight {f.weight}</span>
            </div>
            <p className="mt-1 text-sm text-slate-600">{f.cause}</p>
          </li>
        ))}
      </ul>

      <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 text-sm sm:grid-cols-4">
        <Stat label="Raw score" value={incident.rawScore} />
        <Stat label="Risk" value={`${incident.riskScore}/100`} />
        <Stat label="Confidence" value={`${incident.confidence}%`} />
        <Stat label="Correlated groups" value={incident.correlationClusters?.length ?? 0} />
      </dl>
    </section>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="font-semibold tabular-nums text-slate-800">{value}</dd>
    </div>
  );
}
