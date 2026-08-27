import { Check } from "lucide-react";
import { formatClock } from "@/lib/blackbox/schemas";

/**
 * Evidence for the conclusion. Every line points at a real stored event, so
 * nothing here is asserted without something behind it.
 */
export default function EvidenceList({ incident }) {
  const evidence = incident.evidence ?? [];
  if (!evidence.length) return null;

  const byId = new Map((incident.events ?? []).map((e) => [e.eventId, e]));

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Evidence</h2>

      <ul className="mt-4 space-y-3">
        {evidence.map((item, i) => {
          const event = byId.get(item.eventId);

          return (
            <li key={`${item.eventId ?? i}`} className="flex gap-3">
              <Check size={16} className="mt-0.5 shrink-0 text-teal-600" />
              <div className="min-w-0">
                <p className="text-sm text-slate-800">{item.note}</p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {formatClock(item.timestamp)}
                  {event?.path && <span className="font-mono"> · {event.path}</span>}
                  {item.eventId && <span className="font-mono"> · {item.eventId}</span>}
                </p>
              </div>
            </li>
          );
        })}
      </ul>

      <FileEvidence incident={incident} />
    </section>
  );
}

/** File-level detail for the suspicious file, when the collector sent it. */
function FileEvidence({ incident }) {
  const fileEvent = (incident.events ?? []).find(
    (e) => e.type === "executable_created" || (e.type === "file_created" && e.path)
  );
  if (!fileEvent) return null;

  const meta = fileEvent.metadata ?? {};
  const rows = [
    ["Path", fileEvent.path],
    ["Action", fileEvent.type === "executable_created" ? "Created" : "Created"],
    ["Extension", meta.extension ?? extensionOf(fileEvent.path)],
    ["Executable", meta.executable ? "Yes" : undefined],
    ["SHA256", meta.sha256 ?? "Not provided by collector"],
    ["Permissions", meta.permissions],
    ["Size", meta.bytes ? `${meta.bytes} bytes` : undefined],
  ].filter(([, value]) => value !== undefined && value !== null && value !== "");

  if (!rows.length) return null;

  return (
    <div className="mt-6 rounded-lg bg-slate-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">File detail</p>
      <dl className="mt-3 space-y-1.5">
        {rows.map(([label, value]) => (
          <div key={label} className="grid gap-1 sm:grid-cols-[110px_minmax(0,1fr)]">
            <dt className="text-xs text-slate-400">{label}</dt>
            <dd className="break-all font-mono text-xs text-slate-700">{String(value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function extensionOf(path) {
  if (!path) return undefined;
  const dot = path.lastIndexOf(".");
  return dot > -1 ? path.slice(dot) : undefined;
}
