import Link from "next/link";
import { ChevronRight } from "lucide-react";

const DOT = {
  critical: "bg-rose-500",
  high: "bg-orange-500",
  medium: "bg-amber-500",
  low: "bg-sky-500",
};

/**
 * One priority queue for the whole dashboard: security findings and collector
 * problems side by side, most urgent first.
 */
export default function NeedsAttention({ items }) {
  if (!items.length) return null;

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
        <h2 className="text-sm font-semibold tracking-wide text-slate-700 uppercase">
          Needs attention
        </h2>
        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
          {items.length}
        </span>
      </header>

      <ul className="divide-y divide-slate-100">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              href={item.href}
              className="flex items-center gap-3 px-5 py-3 transition hover:bg-slate-50"
            >
              <span
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[item.severity] ?? "bg-slate-400"}`}
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-900">
                  {item.siteName}
                </span>
                <span className="block truncate text-xs text-slate-500">{item.reason}</span>
              </span>
              <span className="shrink-0 text-xs font-semibold text-slate-600">{item.cta}</span>
              <ChevronRight size={15} className="shrink-0 text-slate-400" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
