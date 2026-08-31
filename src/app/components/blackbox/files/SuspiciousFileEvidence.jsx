import Link from "next/link";
import { getFilesBySite } from "@/lib/blackbox/storage";
import { attentionFiles, levelFor } from "@/lib/blackbox/files/model";
import FileRiskBadge from "./FileRiskBadge";
import { findingLineRange } from "./SuspiciousFileCard";

/**
 * Suspicious File Evidence on an incident page: the attention-worthy files
 * whose activity overlaps the incident window, each one click from its exact
 * suspicious lines.
 */
export default async function SuspiciousFileEvidence({ incident }) {
  const files = attentionFiles(await getFilesBySite(incident.siteId));

  const start = incident.startedAt ?? 0;
  const end = incident.endedAt ?? incident.startedAt ?? 0;
  const related = files.filter((f) => {
    const t = f.modifiedAt ?? f.lastSeenAt ?? 0;
    return t >= start - 30 * 60_000 && t <= end + 30 * 60_000;
  });

  if (!related.length) return null;

  return (
    <section className="rounded-xl border border-rose-200 bg-rose-50/50 p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-rose-700">
        Suspicious file evidence
      </h2>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {related.map((file) => {
          const range = findingLineRange(file);
          return (
            <div key={file.id} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <FileRiskBadge level={levelFor(file.riskScore ?? 0)} risk={file.riskScore} />
                <span className="text-xs text-slate-400">Confidence {file.confidence}%</span>
              </div>
              <p className="mt-2 font-mono text-sm font-semibold text-slate-900">{file.filename}</p>
              <p className="break-all font-mono text-xs text-slate-500">/{file.relativePath}</p>
              {range && (
                <p className="mt-2 text-xs text-slate-600">
                  Suspicious lines <span className="font-mono font-semibold text-rose-700">{range.start}–{range.end}</span>
                </p>
              )}
              {(file.signals ?? []).slice(0, 3).length > 0 && (
                <p className="mt-1 text-xs text-slate-500">{(file.signals ?? []).slice(0, 3).join(" · ")}</p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  href={`/websites/${incident.siteId}/files/${file.id}`}
                  className="inline-block rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                >
                  Inspect File
                </Link>
                {/* Guidance only — this scrolls to the fix steps and changes nothing. */}
                <a
                  href="#how-to-fix"
                  className="inline-block rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  How to Fix
                </a>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
