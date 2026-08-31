"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Line-level evidence viewer. Shows each finding, its highlighted excerpt with
 * accurate line numbers, and a plain-English explanation. Never executes code.
 */
export default function CodeEvidence({ findings = [] }) {
  const [index, setIndex] = useState(0);

  if (!findings.length) {
    return <p className="text-sm text-slate-500">No line-level findings recorded for this file.</p>;
  }

  const finding = findings[Math.min(index, findings.length - 1)];
  const inRange = (line) => line >= finding.startLine && line <= finding.endLine;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      {/* Finding navigation */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
        {findings.map((f, i) => (
          <button
            key={f.id ?? i}
            onClick={() => setIndex(i)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
              i === index ? "bg-rose-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            Finding {i + 1} · {f.startLine}
            {f.endLine !== f.startLine ? `–${f.endLine}` : ""}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            disabled={index === 0}
            className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-40"
            aria-label="Previous finding"
          >
            <ChevronLeft size={15} />
          </button>
          <button
            onClick={() => setIndex((i) => Math.min(findings.length - 1, i + 1))}
            disabled={index === findings.length - 1}
            className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-40"
            aria-label="Next finding"
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_280px]">
        {/* Code with highlighted lines */}
        <pre className="max-h-[420px] overflow-auto bg-slate-950 p-4 text-xs leading-relaxed text-slate-100">
          {(finding.excerpt ?? []).map((ln) => (
            <div
              key={ln.line}
              className={`flex gap-3 rounded-sm px-1 ${
                inRange(ln.line) ? "bg-rose-500/20 ring-1 ring-inset ring-rose-400/40" : ""
              }`}
            >
              <span className={`w-8 shrink-0 select-none text-right ${inRange(ln.line) ? "font-semibold text-rose-300" : "text-slate-500"}`}>
                {ln.line}
              </span>
              <code className="whitespace-pre">{ln.text}</code>
            </div>
          ))}
        </pre>

        {/* Explanation panel */}
        <aside className="border-t border-slate-100 p-4 lg:border-l lg:border-t-0">
          <p className="text-xs uppercase tracking-wide text-slate-400">
            Line{finding.endLine !== finding.startLine ? "s" : ""} {finding.startLine}
            {finding.endLine !== finding.startLine ? `–${finding.endLine}` : ""}
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-900">{finding.label}</p>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">{finding.explanation}</p>
          <div className="mt-4 space-y-1 text-xs text-slate-500">
            <p>Severity <span className="font-semibold capitalize text-slate-700">{finding.severity}</span></p>
            <p>Confidence <span className="font-semibold text-slate-700">{finding.confidence}%</span></p>
            {finding.function && <p>Function <span className="font-mono text-slate-700">{finding.function}()</span></p>}
          </div>
        </aside>
      </div>
    </div>
  );
}
