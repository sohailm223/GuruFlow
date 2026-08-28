import { CATEGORY_LABELS } from "@/lib/blackbox/schemas";

/**
 * What the incident touched, and who was involved.
 */
export default function ImpactSummary({ incident }) {
  const areas = incident.affectedAreas ?? [];
  const actors = incident.actors ?? [];
  const impact = incident.concepts?.impact;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Impact</h2>

      <p className="mt-3 text-slate-700">
        {impact ?? "No user-facing impact was detected in this window."}
      </p>

      {areas.length > 0 && (
        <div className="mt-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Affected areas
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {areas.map((a) => (
              <li
                key={a.category}
                className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600"
              >
                {CATEGORY_LABELS[a.category] ?? a.category}
                <span className="ml-1.5 text-slate-400">{a.count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {actors.length > 0 && (
        <div className="mt-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Actors</p>
          <ul className="mt-2 space-y-1.5">
            {actors.map((a) => (
              <li key={a.username} className="text-sm text-slate-700">
                <span className="font-medium">{a.username}</span>
                {a.role && <span className="text-slate-500"> · {a.role}</span>}
                <span className="text-slate-400">
                  {" "}
                  · {a.eventCount} event{a.eventCount === 1 ? "" : "s"}
                </span>
                {a.ips.length > 0 && (
                  <span className="font-mono text-xs text-slate-400"> · {a.ips.join(", ")}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
