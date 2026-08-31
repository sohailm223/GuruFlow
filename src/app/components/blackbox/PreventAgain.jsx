import { ShieldCheck } from "lucide-react";

const LEVEL_STYLE = {
  HIGH: "bg-rose-50 text-rose-700",
  MEDIUM: "bg-amber-50 text-amber-700",
  LOW: "bg-slate-100 text-slate-600",
};

const ORDER = { HIGH: 0, MEDIUM: 1, LOW: 2 };

/**
 * Prevent it again — general hardening, derived from what this incident touched.
 *
 * These are recommendations only. ScanSite never applies them, and none of them
 * depend on a vulnerability database.
 */
export default function PreventAgain({ incident }) {
  const items = [...(incident.prevention ?? [])].sort((a, b) => (ORDER[a.level] ?? 9) - (ORDER[b.level] ?? 9));
  if (!items.length) return null;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
        <ShieldCheck size={16} /> Prevent It Again
      </h2>
      <ul className="mt-4 space-y-2">
        {items.map((it, i) => (
          <li key={i} className="flex items-start gap-3 rounded-lg border border-slate-100 px-3 py-2">
            <span className={`mt-0.5 rounded px-2 py-0.5 text-[10px] font-semibold tracking-wide ${LEVEL_STYLE[it.level] ?? LEVEL_STYLE.LOW}`}>
              {it.level}
            </span>
            <span className="min-w-0 flex-1 text-sm text-slate-700">
              {it.text}
              {it.evidence?.reason ? (
                <span className="mt-0.5 block text-xs text-slate-500">
                  <span className="font-medium text-slate-600">Because:</span> {it.evidence.reason}
                  {it.evidence.eventId ? <span className="ml-2 font-mono text-[10px] text-slate-400">{it.evidence.eventId}</span> : null}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-slate-400">
        General hardening. ScanSite recommends these; it does not apply them to your website.
      </p>
    </section>
  );
}
