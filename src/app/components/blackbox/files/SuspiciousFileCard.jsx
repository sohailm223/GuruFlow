import Link from "next/link";
import { timeAgo } from "@/lib/blackbox/sites";
import FileRiskBadge from "./FileRiskBadge";
import { levelFor } from "@/lib/blackbox/files/model";

export function findingLineRange(file) {
  const f = file.codeFindings ?? [];
  if (!f.length) return null;
  return {
    start: Math.min(...f.map((x) => x.startLine)),
    end: Math.max(...f.map((x) => x.endLine)),
  };
}

export default function SuspiciousFileCard({ file, siteId, relatedIncident, now }) {
  const range = findingLineRange(file);
  const level = levelFor(file.riskScore ?? 0);

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-2.5">
        <FileRiskBadge level={level} risk={file.riskScore} />
        <span className="text-xs text-slate-400">{timeAgo(file.modifiedAt, now)}</span>
      </div>

      <div className="p-5">
        <p className="font-mono text-base font-semibold text-slate-900">{file.filename}</p>
        <p className="mt-0.5 break-all font-mono text-xs text-slate-500">/{file.relativePath}</p>

        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Risk</p>
            <p className="font-semibold text-slate-900">{file.riskScore}/100</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Confidence</p>
            <p className="font-semibold text-slate-900">{file.confidence}%</p>
          </div>
        </div>

        {range && (
          <p className="mt-3 text-sm text-slate-600">
            Suspicious lines <span className="font-mono font-semibold text-rose-700">{range.start}–{range.end}</span>
          </p>
        )}

        {(file.signals ?? []).length > 0 && (
          <ul className="mt-3 space-y-1">
            {(file.signals ?? []).slice(0, 5).map((s) => (
              <li key={s} className="flex items-center gap-2 text-xs text-slate-600">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" /> {s}
              </li>
            ))}
          </ul>
        )}

        {relatedIncident && (
          <p className="mt-3 truncate text-xs text-slate-500">
            Related incident: <span className="font-medium text-slate-700">{relatedIncident.title}</span>
          </p>
        )}

        <Link
          href={`/websites/${siteId}/files/${file.id}`}
          className="mt-4 inline-flex rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
        >
          Inspect File
        </Link>
      </div>
    </div>
  );
}
