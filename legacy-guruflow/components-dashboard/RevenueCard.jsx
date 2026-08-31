export default function RevenueCard({ amount }) {
  if (amount === undefined || amount === null) return null;

  const formatted =
    typeof amount === "number"
      ? new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: 0,
        }).format(amount)
      : amount;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-emerald-200/60 bg-white p-5 shadow-sm">
      <div
        className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-gradient-to-br from-emerald-300/30 via-emerald-200/10 to-transparent"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-emerald-200/50"
        aria-hidden="true"
      />
      <p className="text-xs uppercase tracking-widest text-emerald-700/80">
        Total Revenue
      </p>
      <p className="mt-2 text-3xl font-semibold text-emerald-900">
        {formatted}
      </p>
      <p className="mt-1 text-sm text-emerald-800/70">
        Updated with latest project budgets
      </p>
    </div>
  );
}
