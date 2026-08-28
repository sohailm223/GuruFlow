import clsx from "clsx";

const STYLES = {
  critical: "bg-rose-50 text-rose-700 ring-rose-200",
  high: "bg-orange-50 text-orange-700 ring-orange-200",
  medium: "bg-amber-50 text-amber-700 ring-amber-200",
  low: "bg-blue-50 text-blue-700 ring-blue-200",
  info: "bg-teal-50 text-teal-700 ring-teal-200",
};

/**
 * Severity is shown as a small badge — never as a page-filling colour.
 */
export default function SeverityBadge({ severity, label, riskScore, size = "sm" }) {
  const key = String(severity ?? "info").toLowerCase();
  const pad = size === "lg" ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-xs";

  return (
    <span
      className={clsx(
        "inline-flex items-center gap-2 rounded-md font-medium uppercase tracking-wide ring-1 ring-inset",
        pad,
        STYLES[key] ?? STYLES.info
      )}
    >
      {label ?? key}
      {typeof riskScore === "number" && (
        <span className="font-semibold tabular-nums opacity-80">{riskScore}/100</span>
      )}
    </span>
  );
}
