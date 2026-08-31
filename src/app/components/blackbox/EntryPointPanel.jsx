import { ArrowDown, HelpCircle } from "lucide-react";
import { ENTRY_POINT_TYPES } from "@/lib/blackbox/entrypoint";

const TONE = {
  Likely: "text-amber-700",
  Possible: "text-amber-700",
  Speculative: "text-slate-600",
  Uncertain: "text-slate-500",
};

/**
 * Likely infection path.
 *
 * Hedged by design: this is the most probable explanation the evidence supports,
 * not a determination. The confidence is derived from the signals listed, and the
 * chain only contains steps that a real event supports.
 */
export default function EntryPointPanel({ incident }) {
  const entry = incident.entryPoint;
  if (!entry) return null;

  const unknown = entry.id === "unknown";

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Likely Infection Path</h2>
        {!unknown && (
          <p className="text-sm text-slate-500">
            Confidence <span className={`font-semibold ${TONE[entry.confidenceLabel] ?? "text-slate-700"}`}>{entry.confidence}%</span>{" "}
            <span className="text-slate-400">({entry.confidenceLabel})</span>
          </p>
        )}
      </div>

      <p className="mt-1 text-xs uppercase tracking-wide text-slate-400">Likely entry point</p>
      <p className="mt-1 text-xl font-semibold text-slate-900">{entry.headline}</p>
      {unknown ? (
        <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          ScanSite will not guess an infection path when the recorded events do not support one. Nothing in this
          window identifies how the activity started, so the entry point stays Unknown rather than being filled in.
        </p>
      ) : (
        <p className="mt-1 text-sm text-slate-500">
          Classification: {entry.label}. ScanSite reports what the recorded events support — it cannot see
          credentials, passwords or source code, so this is a probable path, not a proven one.
        </p>
      )}

      {entry.target ? (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
          <p className="text-xs uppercase tracking-wide text-slate-400">
            {TARGET_LABEL[entry.target.kind] ?? "Subject"}
          </p>
          <p className="mt-0.5 break-all font-mono text-slate-800">
            {entry.target.username ?? entry.target.path ?? entry.target.name ?? "—"}
          </p>
          {entry.target.version ? <p className="text-xs text-slate-500">Version {entry.target.version}</p> : null}
        </div>
      ) : null}

      <div className="mt-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Why ScanSite thinks this</p>
        <ul className="mt-2 space-y-1.5">
          {entry.reasons.map((r, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
              <span>
                {r.text}
                {r.eventId ? <span className="ml-2 font-mono text-[10px] text-slate-400">{r.eventId}</span> : null}
              </span>
            </li>
          ))}
        </ul>
        {(entry.caveats ?? []).length > 0 && (
          <ul className="mt-3 space-y-1">
            {entry.caveats.map((c, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-500">
                <HelpCircle size={14} className="mt-0.5 shrink-0" />
                <span>{c}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {entry.chain.length > 0 && (
        <div className="mt-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Observed sequence</p>
          <ol className="mt-3">
            {entry.chain.map((step, i) => (
              <li key={i}>
                {i > 0 && (
                  <div className="ml-4 flex items-center gap-1 py-1 text-slate-300">
                    <ArrowDown size={14} />
                  </div>
                )}
                <div className="flex items-baseline gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2">
                  <span className="text-sm font-medium text-slate-800">{step.label}</span>
                  {step.detail ? <span className="break-all font-mono text-xs text-slate-500">{step.detail}</span> : null}
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-xs text-slate-400">
            Every step above is backed by a recorded event. Steps ScanSite cannot evidence are not shown.
          </p>
        </div>
      )}

      <details className="mt-5 border-t border-slate-100 pt-3">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-400">
          Infection paths ScanSite can identify
        </summary>
        <ul className="mt-2 flex flex-wrap gap-2">
          {ENTRY_POINT_TYPES.map((t) => (
            <li
              key={t.id}
              className={`rounded px-2 py-1 text-xs ${
                t.id === entry.id
                  ? "bg-slate-900 font-medium text-white"
                  : "bg-slate-100 text-slate-500"
              }`}
            >
              {t.label}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-slate-400">
          ScanSite does not consult a vulnerability database. A plugin or theme classification means its recorded
          activity correlates with this incident — not that a specific known vulnerability was matched.
        </p>
      </details>
    </section>
  );
}

const TARGET_LABEL = {
  account: "Administrator account",
  file: "File",
  plugin: "Plugin",
  theme: "Theme",
  cron: "Scheduled task",
  config: "Configuration",
  application_password: "Application password",
};
