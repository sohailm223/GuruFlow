import Link from "next/link";
import StatusDot from "./StatusDot";
import { timeAgo } from "@/lib/blackbox/sites";

export default function WebsiteCard({ site, health, stats }) {
  return (
    <Link
      href={`/websites/${site.id}`}
      className="block rounded-xl border border-slate-200 bg-white p-5 transition hover:border-slate-300 hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-slate-900">{site.name}</h3>
          <p className="truncate text-sm text-slate-500">{site.host}</p>
        </div>
        <StatusDot tone={health.tone} label={health.label} />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <Metric label="Risk" value={`${stats?.risk ?? 0}/100`} />
        <Metric label="Open Incidents" value={stats?.open ?? 0} />
        <Metric
          label={health.key === "connected" ? "Last Event" : "Last Seen"}
          value={timeAgo(health.key === "connected" ? site.lastEventAt : site.lastSeenAt)}
        />
        <Metric label="Collector" value={site.collectorVersion ?? "—"} />
      </dl>

      <p className="mt-4 text-sm font-medium text-teal-700">View website →</p>
    </Link>
  );
}

function Metric({ label, value }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="truncate font-medium text-slate-800">{value}</dd>
    </div>
  );
}
