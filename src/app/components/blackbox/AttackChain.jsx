import { formatClock } from "@/lib/blackbox/schemas";

/**
 * The attack / change chain — plain React + CSS, no graph library.
 *
 * Links are marked as correlated (same actor / IP / target) or merely
 * sequential, so the reader can see how much of the chain is actually tied
 * together rather than just adjacent in time.
 */
export default function AttackChain({ incident }) {
  const chain = incident.attackChain ?? [];
  if (chain.length < 2) return null;

  const byId = new Map((incident.events ?? []).map((e) => [e.eventId, e]));

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        Attack / Change Chain
      </h2>

      <ol className="mt-5">
        {chain.map((step, i) => {
          const event = byId.get(step.eventId);
          const last = i === chain.length - 1;

          return (
            <li key={step.eventId ?? `${step.type}-${i}`} className="flex gap-4">
              <div className="flex flex-col items-center">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-900 text-xs font-semibold text-white">
                  {i + 1}
                </span>
                {!last && <span className="my-1 w-px flex-1 bg-slate-200" />}
              </div>

              <div className="min-w-0 flex-1 pb-5">
                <p className="text-sm font-medium text-slate-900">
                  {event?.text ?? step.type.replace(/_/g, " ")}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {formatClock(step.timestamp)}
                  {i > 0 && (
                    <span className="ml-2">
                      {step.linked ? "linked by actor / IP" : "followed in sequence"}
                    </span>
                  )}
                </p>
                {event?.path && (
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
