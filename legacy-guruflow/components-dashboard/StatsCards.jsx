export default function StatsCards({ stats = {} }) {
  const formatNumber = (value) =>
    typeof value === "number"
      ? new Intl.NumberFormat("en-US").format(value)
      : value;

  const formatCurrency = (value) =>
    typeof value === "number"
      ? new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: 0,
        }).format(value)
      : value;

  const items = [
    {
      label: "Total Projects",
      value: formatNumber(stats.totalProjects),
      tone: "from-sky-400/20 to-sky-500/5",
      ring: "ring-sky-400/20",
    },
    {
      label: "Active Projects",
      value: formatNumber(stats.activeProjects),
      tone: "from-emerald-400/20 to-emerald-500/5",
      ring: "ring-emerald-400/20",
    },
    {
      label: "Overdue Projects",
      value: formatNumber(stats.overdueProjects),
      tone: "from-rose-400/20 to-rose-500/5",
      ring: "ring-rose-400/20",
    },
    {
      label: "Revenue",
      value: formatCurrency(stats.revenue),
      tone: "from-amber-400/20 to-amber-500/5",
      ring: "ring-amber-400/20",
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {items.map(
        (item, i) =>
          item.value !== undefined && (
            <div
              key={i}
              className={`group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md`}
            >
              <div
                className={`pointer-events-none absolute -right-10 -top-10 h-24 w-24 rounded-full bg-gradient-to-br ${item.tone}`}
                aria-hidden="true"
              />
              <div
                className={`absolute inset-0 rounded-2xl ring-1 ${item.ring}`}
                aria-hidden="true"
              />

              <p className="text-xs uppercase tracking-widest text-slate-500">
                {item.label}
              </p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">
                {item.value}
              </p>
              <div className="mt-3 h-1 w-10 rounded-full bg-slate-900/10 group-hover:bg-slate-900/20" />
            </div>
          )
      )}
    </div>
  );
}
