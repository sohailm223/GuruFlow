import { describeEvent, formatClock } from "@/lib/blackbox/schemas";

/** Raw event feed for a website — metadata only, never secret contents. */
export default function RecentActivity({ events }) {
  if (!events.length) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
        No events received yet.
      </div>
    );
  }

  return (
    <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
      {events.map((event, i) => (
        <li key={event.eventId ?? `${event.timestamp}-${i}`} className="flex gap-4 px-5 py-3">
          <span className="w-16 shrink-0 pt-0.5 text-right font-mono text-xs tabular-nums text-slate-400">
            {formatClock(event.timestamp)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-slate-800">{describeEvent(event)}</p>
            <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-400">
              <span>{event.category}</span>
              {event.actor?.username && <span>{event.actor.username}</span>}
              {event.actor?.ip && <span className="font-mono">{event.actor.ip}</span>}
              {event.eventId && <span className="font-mono">{event.eventId}</span>}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
