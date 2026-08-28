const TONE = {
  critical: "bg-rose-50 text-rose-700 ring-rose-600/20",
  high: "bg-orange-50 text-orange-700 ring-orange-600/20",
  medium: "bg-amber-50 text-amber-700 ring-amber-600/20",
  low: "bg-sky-50 text-sky-700 ring-sky-600/20",
  info: "bg-teal-50 text-teal-700 ring-teal-600/20",
};

export default function FileRiskBadge({ level, risk }) {
  const key = level?.key ?? "info";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${TONE[key] ?? TONE.info}`}
    >
      {level?.label ?? "Verified"}
      {typeof risk === "number" && <span className="font-normal opacity-70">{risk}</span>}
    </span>
  );
}
