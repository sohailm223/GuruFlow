/**
 * Recommendations only — ScanSite never deletes files, removes
 * administrators, edits the database or restores backups on its own.
 */
export default function RecommendedActions({ incident }) {
  const recs = incident.recommendations ?? {};
  const groups = [
    ["Immediate", recs.immediate],
    ["Investigate", recs.investigate],
    ["Recovery", recs.recovery],
  ].filter(([, items]) => items?.length);

  if (!groups.length) return null;

  let n = 0;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        Recommended Actions
      </h2>

      <div className="mt-4 space-y-6">
        {groups.map(([label, items]) => (
          <div key={label}>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {label}
            </p>
            <ol className="mt-2 space-y-2">
              {items.map((text) => (
                <li key={text} className="flex gap-3 text-sm text-slate-700">
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">
                    {++n}
                  </span>
                  {text}
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>

      <p className="mt-6 border-t border-slate-100 pt-4 text-xs text-slate-400">
        ScanSite recommends these steps. It does not modify your website
        automatically.
      </p>
    </section>
  );
}
