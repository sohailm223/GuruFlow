/**
 * Likely cause, with the four separated concepts shown only when the engine
 * actually found them.
 */
export default function LikelyCause({ incident }) {
  const concepts = incident.concepts ?? {};
  const rows = [
    ["Cause", concepts.cause],
    ["Attack / Change", concepts.change],
    ["Persistence", concepts.persistence],
    ["Impact", concepts.impact],
  ].filter(([, value]) => value);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        Likely Cause
      </h2>

      <h3 className="mt-3 text-xl font-semibold text-slate-900">{incident.title}</h3>
      <p className="mt-2 leading-relaxed text-slate-600">{incident.cause}</p>

      <p className="mt-4 text-sm text-slate-500">
        Confidence{" "}
        <span className="font-semibold text-slate-800">{incident.confidence}%</span>{" "}
        — {incident.confidenceLabel}
      </p>

      {rows.length > 0 && (
        <dl className="mt-6 space-y-3 border-t border-slate-100 pt-5">
          {rows.map(([label, value]) => (
            <div key={label} className="grid gap-1 sm:grid-cols-[140px_minmax(0,1fr)]">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                {label}
              </dt>
              <dd className="text-sm text-slate-700">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
