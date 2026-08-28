"use client";

import { useState } from "react";
import { FileCode2, ChevronDown, ChevronRight } from "lucide-react";

/**
 * Read-only viewer for the pushed code snapshot (active theme templates and
 * active plugin main files). Contents arrive capped from the collector; this
 * only ever displays, never edits or executes.
 */
export default function CodeBrowser({ snapshot }) {
  const [open, setOpen] = useState(null);

  if (!snapshot) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
        <p className="text-sm font-medium text-slate-900">No code snapshot yet</p>
        <p className="mt-1 text-sm text-slate-500">
          The collector sends a daily read-only snapshot of theme and plugin code.
        </p>
      </div>
    );
  }

  const files = snapshot.metadata?.files ?? [];

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <ul className="divide-y divide-slate-50">
        {files.map((f) => (
          <li key={f.path}>
            <button
              onClick={() => setOpen(open === f.path ? null : f.path)}
              className="flex w-full items-center gap-2 px-5 py-2.5 text-left transition hover:bg-slate-50"
            >
              <FileCode2 size={15} className="shrink-0 text-slate-400" />
              <span className="min-w-0 flex-1 truncate font-mono text-sm text-slate-700">
                {f.path}
              </span>
              <span className="shrink-0 text-xs text-slate-400">{f.bytes} B</span>
              {f.truncated && (
                <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">
                  truncated
                </span>
              )}
              {open === f.path ? (
                <ChevronDown size={15} className="shrink-0 text-slate-400" />
              ) : (
                <ChevronRight size={15} className="shrink-0 text-slate-400" />
              )}
            </button>

            {open === f.path && (
              <pre className="max-h-96 overflow-auto border-t border-slate-100 bg-slate-950 p-4 text-xs leading-relaxed text-slate-100">
                <code>{f.content}</code>
              </pre>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
