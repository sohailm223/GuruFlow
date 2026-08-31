import SeverityBadge from "./SeverityBadge";
import RiskScore from "./RiskScore";

const HEADLINE = {
  critical: "Possible compromise detected — investigate.",
  high: "Something on your website needs attention.",
  medium: "Your website changed in a way worth checking.",
  low: "A small change was detected.",
  info: "Routine activity was recorded.",
};

/**
 * First screen of an incident: the verdict, not the logs.
 */
export default function IncidentHeader({ incident, siteName }) {
  return (
    <header className="rounded-xl border border-slate-200 bg-white p-6">
      <div className="flex flex-wrap items-center gap-3">
        <SeverityBadge
          severity={incident.severity}
          label={`${incident.severityLabel} incident`}
          size="lg"
        />
        {siteName && <span className="text-sm font-medium text-slate-600">{siteName}</span>}
      </div>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">
        {HEADLINE[incident.severity] ?? "Incident recorded."}
      </h1>

      <p className="mt-2 max-w-2xl text-base leading-relaxed text-slate-600">
        {incident.summary}
      </p>

      <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-400">Risk</dt>
          <dd className="mt-1">
            <RiskScore score={incident.riskScore} severity={incident.severity} />
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-400">Confidence</dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums text-slate-900">
            {incident.confidence}%
            <span className="ml-2 text-xs font-normal text-slate-500">
              {incident.confidenceLabel}
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-400">Window</dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums text-slate-900">
            {incident.durationMinutes}
            <span className="ml-1 text-sm font-normal text-slate-500">min</span>
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-400">Events</dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums text-slate-900">
            {incident.eventCount}
          </dd>
        </div>
      </dl>
    </header>
  );
}
