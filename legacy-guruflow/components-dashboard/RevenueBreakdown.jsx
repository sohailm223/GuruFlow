const COLORS = [
  "#0f766e",
  "#2563eb",
  "#9333ea",
  "#db2777",
  "#f97316",
  "#16a34a",
  "#0ea5e9",
  "#d97706",
];

function polarToCartesian(cx, cy, r, angleDeg) {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(angleRad),
    y: cy + r * Math.sin(angleRad),
  };
}

function donutArc(cx, cy, r, ir, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const innerStart = polarToCartesian(cx, cy, ir, endAngle);
  const innerEnd = polarToCartesian(cx, cy, ir, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";

  return [
    "M",
    start.x,
    start.y,
    "A",
    r,
    r,
    0,
    largeArcFlag,
    0,
    end.x,
    end.y,
    "L",
    innerEnd.x,
    innerEnd.y,
    "A",
    ir,
    ir,
    0,
    largeArcFlag,
    1,
    innerStart.x,
    innerStart.y,
    "Z",
  ].join(" ");
}

function pieSlice(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";

  return [
    "M",
    cx,
    cy,
    "L",
    start.x,
    start.y,
    "A",
    r,
    r,
    0,
    largeArcFlag,
    0,
    end.x,
    end.y,
    "Z",
  ].join(" ");
}

export default function RevenueBreakdown({ projects = [] }) {
  const rows = projects
    .filter((p) => typeof p.budget === "number" && p.budget > 0)
    .map((p, i) => ({
      name: p.name || `Project ${i + 1}`,
      value: p.budget,
      color: COLORS[i % COLORS.length],
    }));

  const total = rows.reduce((sum, r) => sum + r.value, 0);
  if (!total) return null;

  let angle = 0;
  const segments = rows.map((r) => {
    const slice = (r.value / total) * 360;
    const start = angle;
    const end = angle + slice;
    angle = end;
    return { ...r, start, end };
  });

  const labelRadius = 30;
  const topProject = segments.reduce((best, current) =>
    current.value > best.value ? current : best
  );

  const formattedTotal = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(total);

  return (
    <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div
        className="pointer-events-none absolute -right-24 -top-24 h-56 w-56 rounded-full bg-gradient-to-br from-emerald-200/50 via-sky-200/20 to-transparent"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -left-12 bottom-0 h-40 w-40 rounded-full bg-gradient-to-tr from-indigo-200/30 via-fuchsia-200/10 to-transparent"
        aria-hidden="true"
      />

      <div className="relative z-10 grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full border border-emerald-200/70 bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-emerald-800">
              Revenue Pulse
            </span>
            <span className="text-xs text-slate-500">
              {segments.length} active projects
            </span>
          </div>

          <h3 className="mt-4 text-3xl font-semibold text-slate-900">
            {formattedTotal}
          </h3>
          <p className="mt-1 text-sm text-slate-600">
            Source mix by project budget
          </p>

          <div className="mt-5 rounded-2xl border border-slate-200/80 bg-white/70 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-800">
                Top contributor
              </p>
              <span
                className="rounded-full px-2 py-0.5 text-xs font-semibold text-white"
                style={{ background: topProject.color }}
              >
                {Math.round((topProject.value / total) * 100)}%
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-700">
              {topProject.name}
            </p>
          </div>

          <ul className="mt-5 space-y-3 text-sm text-slate-700">
            {segments.map((s, idx) => (
              <li key={`${s.name}-${idx}`} className="space-y-2">
                <div className="flex items-center gap-3">
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ background: s.color }}
                  />
                  <span className="flex-1 truncate">{s.name}</span>
                  <span className="text-slate-500">
                    {Math.round((s.value / total) * 100)}%
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(s.value / total) * 100}%`,
                      background: s.color,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-center justify-center">
          <div className="grid place-items-center rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-sm">
            <svg
              viewBox="0 0 120 120"
              className="h-48 w-48"
              role="img"
              aria-label="Revenue pie chart"
            >
              {segments.map((s, idx) => (
                <path
                  key={`${s.name}-arc-${idx}`}
                  d={pieSlice(60, 60, 48, s.start, s.end)}
                  fill={s.color}
                  style={{ animationDelay: `${idx * 120}ms` }}
                  className="rf-slice"
                />
              ))}
              {segments.map((s, idx) => {
                const mid = (s.start + s.end) / 2;
                const pos = polarToCartesian(60, 60, labelRadius, mid);
                return (
                  <text
                    key={`${s.name}-label-${idx}`}
                    x={pos.x}
                    y={pos.y}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="rf-label"
                    style={{ animationDelay: `${idx * 120 + 200}ms` }}
                  >
                    {Math.round((s.value / total) * 100)}%
                  </text>
                );
              })}
            </svg>
            <p className="mt-3 text-xs uppercase tracking-widest text-slate-400">
              Contribution
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
