import clsx from "clsx";

const TONE = {
  critical: "text-rose-600",
  high: "text-orange-600",
  medium: "text-amber-600",
  low: "text-blue-600",
  info: "text-teal-700",
};

/**
 * The normalised 0–100 score users see. The raw internal score stays in the
 * incident record for debugging but is not the headline number.
 */
export default function RiskScore({ score, severity, size = "md" }) {
  const value = size === "lg" ? "text-3xl" : "text-xl";

  return (
    <div className="flex items-baseline gap-1">
      <span className={clsx("font-semibold tabular-nums", value, TONE[severity] ?? TONE.info)}>
        {score ?? 0}
      </span>
      <span className="text-sm text-slate-400">/100</span>
    </div>
  );
}
