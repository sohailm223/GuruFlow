import { CheckCircle2, Circle } from "lucide-react";
import { timeAgo } from "@/lib/blackbox/sites";

/**
 * Low-importance, routine activity — updates that completed with no suspicious
 * follow-up, successful logins, and similar. Kept out of the incident queue so
 * the urgent items stand out.
 */
export default function RecentActivityFeed({ activity, routineIncidents = [], now }) {
  const rows = [
    ...activity.map((a, i) => ({ id: `ev-${i}`, text: a.text, time: a.time, tone: a.tone })),
    ...routineIncidents.slice(0, 3).map((i) => ({
      id: i.id,
      text: i.title,
      time: timeAgo(i.startedAt, now),
      tone: "ok",
    })),
  ];

  if (!rows.length) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold tracking-wide text-slate-700 uppercase">
          Recent activity
        </h2>
        <p className="mt-2 text-sm text-slate-500">No routine activity recorded yet.</p>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <header className="border-b border-slate-100 px-5 py-3.5">
        <h2 className="text-sm font-semibold tracking-wide text-slate-700 uppercase">
          Recent activity
        </h2>
      </header>

      <ul className="divide-y divide-slate-50">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center gap-3 px-5 py-2.5">
            {row.tone === "ok" ? (
              <CheckCircle2 size={15} className="shrink-0 text-teal-600" />
            ) : (
              <Circle size={8} className="shrink-0 text-slate-300" />
            )}
            <span className="min-w-0 flex-1 truncate text-sm text-slate-600">{row.text}</span>
            <span className="shrink-0 text-xs text-slate-400">{row.time}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
