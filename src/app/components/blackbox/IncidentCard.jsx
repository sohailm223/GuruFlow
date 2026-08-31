import Link from "next/link";
import { ArrowRight } from "lucide-react";
import SeverityBadge from "./SeverityBadge";
import { timeAgo } from "@/lib/blackbox/sites";

const STATUS_LABEL = {
  new: "New",
  investigating: "Investigating",
  confirmed: "Confirmed",
  false_positive: "False positive",
  remediated: "Remediated",
  monitoring: "Monitoring",
  resolved: "Resolved",
};

const STRIPE = {
  critical: "bg-rose-500",
  high: "bg-orange-500",
  medium: "bg-amber-500",
  low: "bg-sky-500",
  info: "bg-slate-400",
};

/**
 * An incident card that answers "why should I care?" in five seconds:
 * which website, what happened in plain words, how sure we are, the attack
 * chain, and one next action.
 */
export default function IncidentCard({ incident, siteName, now }) {
  const chain = shortChain(incident);

  return (
    <Link
      href={`/incidents/${incident.id}`}
      className="group relative block overflow-hidden rounded-xl border border-slate-200 bg-white p-5 pl-6 transition hover:border-slate-300 hover:shadow-md"
    >
      <span
        className={`absolute inset-y-0 left-0 w-1.5 ${STRIPE[incident.severity] ?? STRIPE.info}`}
        aria-hidden
      />

      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge
          severity={incident.severity}
          label={incident.severityLabel}
          riskScore={incident.riskScore}
        />
        {incident.status !== "new" && (
          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
            {STATUS_LABEL[incident.status] ?? incident.status}
          </span>
        )}
        <span className="ml-auto text-xs text-slate-400">
          {timeAgo(incident.startedAt, now)}
        </span>
      </div>

      {siteName && (
        <p className="mt-3 text-sm font-semibold text-slate-900">{siteName}</p>
      )}

      <h3 className="mt-0.5 text-base font-medium text-slate-800">{incident.title}</h3>
      <p className="mt-1.5 line-clamp-2 text-sm text-slate-600">{incident.summary}</p>

      {chain && (
        <p className="mt-3 rounded-md bg-slate-50 px-2.5 py-1.5 font-mono text-xs text-slate-600">
          {chain}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700">
          {incident.eventCount} event{incident.eventCount === 1 ? "" : "s"}
        </span>
        <span>Risk {incident.riskScore}/100</span>
        <span>Confidence {incident.confidence}%</span>
        <span>{incident.durationMinutes} min</span>

        <span className="ml-auto inline-flex items-center gap-1 font-semibold text-rose-700 group-hover:gap-2">
          Investigate
          <ArrowRight size={13} />
        </span>
      </div>
    </Link>
  );
}

/** "support_wp → x1.php → cron → HTTP 500" */
export function shortChain(incident) {
  const steps = (incident.attackChain ?? [])
    .slice(0, 4)
    .map((step) => stepLabel(step, incident));

  if (steps.length < 2) return null;
  return steps.join(" → ");
}

function stepLabel(step, incident) {
  const event = (incident.events ?? []).find((e) => e.eventId === step.eventId);
  if (!event) return step.type;

  const name =
    event.target?.name ?? event.target?.plugin ?? event.target?.username ?? event.path;

  if (event.type === "site_error_burst") return `HTTP ${event.metadata?.httpStatus ?? 500}`;
  if (event.type === "cron_added") return "cron";
  if (name) return name.split("/").pop();
  return event.type.replace(/_/g, " ");
}
