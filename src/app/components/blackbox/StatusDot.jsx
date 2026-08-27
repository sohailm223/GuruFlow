import clsx from "clsx";

const TONES = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  bad: "bg-rose-500",
  pending: "bg-slate-400",
  neutral: "bg-slate-300",
};

export default function StatusDot({ tone = "neutral", label, className }) {
  return (
    <span className={clsx("inline-flex items-center gap-2 text-sm", className)}>
      <span
        className={clsx(
          "h-2 w-2 shrink-0 rounded-full",
          TONES[tone] ?? TONES.neutral
        )}
      />
      {label && <span className="text-slate-600">{label}</span>}
    </span>
  );
}
