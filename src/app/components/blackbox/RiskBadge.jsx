const STYLES = {
  CRITICAL: "bg-rose-500/15 text-rose-600 ring-rose-500/30",
  HIGH: "bg-orange-500/15 text-orange-600 ring-orange-500/30",
  MEDIUM: "bg-amber-500/15 text-amber-700 ring-amber-500/30",
  LOW: "bg-sky-500/15 text-sky-700 ring-sky-500/30",
  INFO: "bg-slate-500/15 text-slate-600 ring-slate-500/30",
};

export default function RiskBadge({ risk, score, size = "sm" }) {
  const style = STYLES[risk] ?? STYLES.INFO;
  const pad = size === "lg" ? "px-3 py-1.5 text-sm" : "px-2 py-0.5 text-xs";

  return (
    <span
      className={`inline-flex items-center gap-2 rounded font-mono font-semibold uppercase tracking-widest ring-1 ${pad} ${style}`}
    >
      {risk}
      {typeof score === "number" && (
        <span className="font-normal opacity-70">{score}</span>
      )}
    </span>
  );
}
