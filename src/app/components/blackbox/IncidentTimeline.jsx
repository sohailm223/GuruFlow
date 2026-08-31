import { formatClock } from "@/lib/blackbox/schemas";

/**
 * The full tape, shown after the verdict rather than instead of it.
 */
export default function IncidentTimeline({ incident }) {
  const events = incident.events ?? [];

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Timeline</h2>

      <ol className="mt-4">
        {events.map((event, i) => {
          const last = i === events.length - 1;
          const notable = (event.score ?? 0) >= 12;

          return (
            <li key={event.eventId ?? `${event.timestamp}-${i}`} className="flex gap-4">
              <div className="w-16 shrink-0 pt-0.5 text-right">
                <span className="font-mono text-xs tabular-nums text-slate-500">
                  {formatClock(event.timestamp)}
                </span>
              </div>

              <div className="relative flex w-4 shrink-0 justify-center">
                {!last && <span className="absolute top-3 bottom-0 w-px bg-slate-200" />}
                <span
                  className={`relative mt-1.5 h-2 w-2 shrink-0 rounded-full ring-4 ring-white ${
                    notable ? "bg-rose-500" : "bg-slate-300"
                  }`}
                />
              </div>

              <div className="min-w-0 flex-1 pb-4">
                <p
                  className={`text-sm ${
                    notable ? "font-medium text-slate-900" : "text-slate-700"
                  }`}
                >
                  {event.text}
                </p>
                <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-400">
                  <span>{event.category}</span>
                  {event.actor?.username && <span>{event.actor.username}</span>}
                  {event.actor?.ip && <span className="font-mono">{event.actor.ip}</span>}
                  {event.changes?.from && event.changes?.to && (
                    <span className="font-mono">
                      {event.changes.from} → {event.changes.to}
                    </span>
                  )}
                  {event.eventId && <span className="font-mono">{event.eventId}</span>}
                </div>
                {event.path && (
                  <p className="mt-1 truncate font-mono text-xs text-slate-500">{event.path}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
