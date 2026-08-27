import Link from "next/link";
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

export default function IncidentCard({ incident, siteName }) {
  const chain = shortChain(incident);

  return (
    <Link
      href={`/incidents/${incident.id}`}
      className="block rounded-xl border border-slate-200 bg-white p-5 transition hover:border-slate-300 hover:shadow-sm"
    >
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
          {timeAgo(incident.startedAt)}
        </span>
      </div>

      <h3 className="mt-3 text-base font-semibold text-slate-900">{incident.title}</h3>
      <p className="mt-1 line-clamp-2 text-sm text-slate-600">{incident.summary}</p>

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        {siteName && <span className="font-medium text-slate-700">{siteName}</span>}
        <span>
          {incident.eventCount} event{incident.eventCount === 1 ? "" : "s"}
        </span>
        <span>{incident.durationMinutes} min</span>
        <span>Confidence {incident.confidence}%</span>
      </div>

      {chain && (
        <p className="mt-3 truncate font-mono text-xs text-slate-500">{chain}</p>
      )}
    </Link>
  );
}

/** "support_wp → x1.php → cron → HTTP 500" */
function shortChain(incident) {
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
