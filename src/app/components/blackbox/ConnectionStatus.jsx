import StatusDot from "./StatusDot";
import { timeAgo } from "@/lib/blackbox/sites";

/**
 * One of: Connected / Disconnected / Connection Issue / Pending / Never Connected.
 * Never flips to disconnected on a single missed heartbeat — WP-Cron is late
 * more often than it is broken.
 */
export default function ConnectionStatus({ health }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg bg-slate-50 px-4 py-3">
      <StatusDot tone={health.tone} label={health.label} className="font-medium text-slate-800" />
      {health.since && (
        <span className="text-xs text-slate-500">last seen {timeAgo(health.since)}</span>
      )}
    </div>
  );
}
