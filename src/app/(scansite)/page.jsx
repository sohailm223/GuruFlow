import Link from "next/link";
import {
  Plus,
  Globe,
  TriangleAlert,
  ShieldAlert,
  FileWarning,
  ArrowRight,
  ShieldCheck,
  FilePen,
  FileQuestion,
  OctagonAlert,
  Copy,
  Pin,
} from "lucide-react";
import { getOverview } from "@/lib/blackbox/dashboard";
import { getFiles } from "@/lib/blackbox/storage";
import { timeAgo, nowMs } from "@/lib/blackbox/sites";
import { formatClock } from "@/lib/blackbox/schemas";

export const dynamic = "force-dynamic";

/* ------------------------------ helpers ------------------------------ */

const BUCKET = {
  verified: "verified",
  expected_change: "changed",
  modified: "changed",
  new: "changed",
  deleted: "changed",
  unknown: "changed",
  suspicious: "suspicious",
  critical: "critical",
};

function aggregate(files) {
  const agg = { checked: files.length, verified: 0, changed: 0, suspicious: 0, critical: 0 };
  for (const f of files) agg[BUCKET[f.integrityStatus] ?? "changed"]++;
  const risky = agg.suspicious + agg.critical;
  const score = Math.max(
    0,
    Math.min(100, Math.round(100 - agg.critical * 8 - agg.suspicious * 4 - agg.changed * 0.1))
  );
  return { ...agg, score, risky };
}

function attentionFiles(files) {
  return files
    .filter((f) => f.integrityStatus === "suspicious" || f.integrityStatus === "critical" || (f.riskScore ?? 0) >= 40)
    .sort((a, b) => (b.riskScore ?? 0) - (a.riskScore ?? 0));
}

function Donut({ agg }) {
  const total = Math.max(1, agg.checked);
  const segs = [
    { key: "verified", color: "#10b981" },
    { key: "changed", color: "#f59e0b" },
    { key: "suspicious", color: "#fb923c" },
    { key: "critical", color: "#f43f5e" },
  ];
  const C = 2 * Math.PI * 40;
  let offset = 0;
  return (
    <div className="relative h-40 w-40">
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r="40" fill="none" stroke="#1e293b" strokeWidth="12" />
        {segs.map((s) => {
          const frac = agg[s.key] / total;
          if (frac <= 0) return null;
          const dash = frac * C;
          const el = (
            <circle
              key={s.key}
              cx="50"
              cy="50"
              r="40"
              fill="none"
              stroke={s.color}
              strokeWidth="12"
              strokeDasharray={`${dash} ${C - dash}`}
              strokeDashoffset={-offset}
            />
          );
          offset += dash;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-semibold text-slate-100">{agg.score}</span>
        <span className="text-[10px] text-slate-500">/100 Integrity</span>
      </div>
    </div>
  );
}

const RISK_TONE = (r) =>
  r >= 80 ? "text-rose-400" : r >= 60 ? "text-orange-400" : r >= 40 ? "text-amber-400" : "text-emerald-400";

const HEALTH_TONE = {
  critical: "text-rose-400",
  attention: "text-amber-400",
  healthy: "text-emerald-400",
};

function StatCard({ icon: Icon, label, value, sub, tone = "text-sky-400" }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="flex items-center gap-3">
        <Icon size={18} className={tone} />
        <p className="text-sm text-slate-400">{label}</p>
      </div>
      <p className="mt-3 text-3xl font-semibold text-slate-100">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{sub}</p>
    </div>
  );
}

function Panel({ title, action, children }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60">
      <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</p>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

/* ------------------------------ page ------------------------------ */

export default async function OverviewPage() {
  const data = await getOverview();
  const files = await getFiles();
  const now = nowMs();
  const agg = aggregate(files);
  const flagged = attentionFiles(files);
  const topFile = flagged[0] ?? null;
  const topFileSite = topFile ? data.sites.find((s) => s.site.id === topFile.siteId)?.site ?? null : null;
  const relatedIncident = topFile
    ? data.incidents.find((i) => i.siteId === topFile.siteId && (i.severity === "critical" || i.severity === "high"))
    : null;

  const firstFinding = topFile?.codeFindings?.[0] ?? null;

  // Routine maintenance is shown at the bottom of the page, never mixed in
  // with the items that need attention.
  const routine = (data.routineIncidents ?? []).slice(0, 6);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Overview</h1>
          <p className="mt-1 text-sm text-slate-500">See what needs attention across your connected WordPress websites.</p>
        </div>
        <Link
          href="/websites/add"
          className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-500"
        >
          <Plus size={16} /> Add Website
        </Link>
      </div>

      {data.top && (
        <div className="rounded-2xl border border-rose-800/60 bg-rose-950/40 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="grid h-14 w-14 place-items-center rounded-xl bg-rose-500/15">
                <OctagonAlert size={26} className="text-rose-400" />
              </div>
              <div>
                <div className="flex items-center gap-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-rose-400">Attention required</p>
                  <span className="rounded border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-rose-300">CRITICAL</span>
                </div>
                <p className="mt-1 text-lg font-semibold text-slate-100">Possible compromise on {data.topSite?.name ?? "a website"}</p>
                <p className="mt-1 text-sm text-slate-400">{data.top.title}</p>
              </div>
            </div>
            <Link
              href={`/incidents/${data.top.id}`}
              className="inline-flex items-center gap-2 rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white hover:bg-rose-400"
            >
              Investigate Incident <ArrowRight size={15} />
            </Link>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-slate-400">
            <span className="rounded bg-rose-500/10 px-2 py-1 font-mono text-rose-300">{data.top.evidence?.[0]?.path ?? data.topSite?.url}</span>
            <span>Risk <span className="font-semibold text-rose-300">{data.top.riskScore ?? 0}/100</span></span>
            <span>{timeAgo(data.top.startedAt, now)}</span>
          </div>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
        {/* left column */}
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard icon={Globe} label="Sites Monitored" value={data.counts.sitesMonitored} sub={`${data.counts.connected} connected`} tone="text-sky-400" />
            <StatCard icon={TriangleAlert} label="Need Attention" value={data.counts.needAttention} sub={`${data.counts.critical} critical`} tone="text-amber-400" />
            <StatCard icon={ShieldAlert} label="Open Incidents" value={data.counts.openIncidents} sub="across all sites" tone="text-rose-400" />
            <StatCard icon={FileWarning} label="Suspicious Files" value={agg.risky} sub={`${agg.critical} critical`} tone="text-orange-400" />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Criticals come before any summary chart: this is the list an
                operator acts on. Routine maintenance is deliberately excluded
                here (see Recent Activity at the bottom). */}
            <Panel title="Needs Attention">
              {data.needsAttention.length === 0 ? (
                <p className="text-sm text-slate-500">Nothing needs attention right now.</p>
              ) : (
                <div className="space-y-3">
                  {data.needsAttention.slice(0, 4).map((n) => (
                    <Link
                      key={n.id}
                      href={n.href ?? "#"}
                      className="block rounded-xl border border-slate-800 bg-slate-950/60 p-3 hover:border-slate-700"
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                            n.severity === "critical"
                              ? "bg-rose-500/10 text-rose-400"
                              : n.severity === "high"
                              ? "bg-orange-500/10 text-orange-400"
                              : "bg-amber-500/10 text-amber-400"
                          }`}
                        >
                          {n.severity.toUpperCase()}
                        </span>
                        <span className="text-[11px] text-slate-500">{timeAgo(n.at, now)}</span>
                      </div>
                      <p className="mt-1 text-sm font-medium text-slate-200">{n.siteName}</p>
                      <p className="text-xs text-slate-500">{n.reason}</p>
                    </Link>
                  ))}
                </div>
              )}
            </Panel>

            <Panel
              title="File Security"
              action={<Link href="/files" className="text-xs text-teal-400 hover:underline">View File Integrity</Link>}
            >
              <div className="flex items-center gap-5">
                <Donut agg={agg} />
                <div className="space-y-2 text-sm">
                  <p className="text-slate-300"><span className="font-semibold text-slate-100">{agg.checked.toLocaleString()}</span> files checked</p>
                  {[
                    ["verified", "Verified", "#10b981"],
                    ["changed", "Changed", "#f59e0b"],
                    ["suspicious", "Suspicious", "#fb923c"],
                    ["critical", "Critical", "#f43f5e"],
                  ].map(([k, label, color]) => (
                    <div key={k} className="flex items-center gap-2 text-slate-400">
                      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
                      {label}
                      <span className="ml-auto font-semibold text-slate-200">{agg[k]}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Panel>

          </div>

          <Panel title="Website Health" action={<Link href="/websites" className="text-xs text-teal-400 hover:underline">View all</Link>}>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="pb-2 font-medium">Website</th>
                    <th className="pb-2 font-medium">Health</th>
                    <th className="pb-2 font-medium">Collector</th>
                    <th className="pb-2 font-medium">File Integrity</th>
                    <th className="pb-2 font-medium">Risk</th>
                    <th className="pb-2 font-medium">Incidents</th>
                    <th className="pb-2 font-medium">Last Seen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {data.sites.map((s) => (
                    <tr key={s.site.id}>
                      <td className="py-2.5">
                        <Link href={`/websites/${s.site.id}`} className="font-medium text-slate-200 hover:text-teal-300">
                          {s.site.name}
                        </Link>
                      </td>
                      <td className={`py-2.5 capitalize ${HEALTH_TONE[s.websiteHealth] ?? "text-slate-400"}`}>{s.websiteHealth}</td>
                      <td className="py-2.5 capitalize text-slate-400">{s.collector.key}</td>
                      <td className="py-2.5 text-slate-400">
                        {s.fileStats.critical ? <span className="text-rose-400">{s.fileStats.critical} critical</span> : "Verified"}
                      </td>
                      <td className={`py-2.5 font-semibold ${RISK_TONE(s.stats.risk)}`}>{s.stats.risk}/100</td>
                      <td className="py-2.5 text-slate-400">{s.stats.open}</td>
                      <td className="py-2.5 text-slate-500">{timeAgo(s.site.lastSeenAt, now)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>

        {/* right column */}
        <div className="space-y-6">
          <Panel
            title="File Integrity"
            action={<Link href="/files" className="rounded-lg bg-teal-600/90 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-500">Start Scan</Link>}
          >
            <div className="grid grid-cols-2 gap-3">
              {[
                [ShieldCheck, "Verified", agg.verified, "text-emerald-400"],
                [FilePen, "Changed", agg.changed, "text-amber-400"],
                [FileQuestion, "Suspicious", agg.suspicious, "text-orange-400"],
                [OctagonAlert, "Critical", agg.critical, "text-rose-400"],
              ].map(([Icon, label, value, tone]) => (
                <div key={label} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                  <Icon size={16} className={tone} />
                  <p className="mt-2 text-xl font-semibold text-slate-100">{value.toLocaleString()}</p>
                  <p className="text-xs text-slate-500">{label}</p>
                </div>
              ))}
            </div>

            <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">Suspicious Files</p>
            <div className="mt-2 space-y-2">
              {flagged.length === 0 ? (
                <p className="text-sm text-slate-500">No suspicious files detected.</p>
              ) : (
                flagged.slice(0, 4).map((f) => (
                  <Link
                    key={`${f.siteId}:${f.relativePath}`}
                    href={`/websites/${f.siteId}/files/${f.id}`}
                    className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/60 p-3 hover:border-slate-700"
                  >
                    <div className="min-w-0">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          f.integrityStatus === "critical" ? "bg-rose-500/10 text-rose-400" : "bg-orange-500/10 text-orange-400"
                        }`}
                      >
                        {f.integrityStatus.toUpperCase()}
                      </span>
                      <p className="mt-1 truncate text-sm text-slate-200">{f.filename}</p>
                      <p className="truncate text-xs text-slate-500">{f.relativePath}</p>
                    </div>
                    <div className="text-right">
                      <p className={`text-lg font-semibold ${RISK_TONE(f.riskScore ?? 0)}`}>{f.riskScore ?? 0}</p>
                      <p className="text-[10px] text-slate-500">/100</p>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </Panel>

          <Panel title="Inspect File" action={topFile && <span className="rounded border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-rose-300">CRITICAL</span>}>
            {!topFile ? (
              <p className="text-sm text-slate-500">Select a suspicious file to inspect it.</p>
            ) : (
              <div className="space-y-4">
                <div>
                  <p className="text-lg font-semibold text-slate-100">{topFile.filename}</p>
                  <p className="truncate text-xs text-slate-500">{topFile.relativePath}</p>
                </div>

                <div className="flex items-center gap-4 text-sm">
                  <span className="text-slate-400">Risk <span className={`font-semibold ${RISK_TONE(topFile.riskScore ?? 0)}`}>{topFile.riskScore ?? 0}/100</span></span>
                  <span className="text-slate-400">Confidence <span className="font-semibold text-slate-200">{topFile.confidence ?? 40}%</span></span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg bg-slate-950/60 p-2"><p className="text-slate-500">Size</p><p className="text-slate-200">{(topFile.size / 1024).toFixed(1)} KB</p></div>
                  <div className="rounded-lg bg-slate-950/60 p-2"><p className="text-slate-500">Modified</p><p className="text-slate-200">{formatClock(topFile.modifiedAt)}</p></div>
                  <div className="col-span-2 rounded-lg bg-slate-950/60 p-2">
                    <p className="flex items-center gap-1 text-slate-500"><Copy size={11} /> SHA-256</p>
                    <p className="truncate font-mono text-slate-300">{topFile.sha256}</p>
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Detection Signals</p>
                  <ul className="mt-2 space-y-1.5">
                    {(topFile.signals ?? []).slice(0, 6).map((s) => (
                      <li key={s.id ?? s.label} className="flex items-center gap-2 text-sm text-slate-300">
                        <span className={`h-1.5 w-1.5 rounded-full ${s.severity === "critical" ? "bg-rose-400" : s.severity === "high" ? "bg-orange-400" : "bg-amber-400"}`} />
                        {s.label}
                      </li>
                    ))}
                    {(!topFile.signals || topFile.signals.length === 0) && <li className="text-sm text-slate-500">Integrity signals only.</li>}
                  </ul>
                </div>

                {firstFinding && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Suspicious Code (Lines {firstFinding.startLine}–{firstFinding.endLine})
                    </p>
                    <pre className="mt-2 max-h-56 overflow-auto rounded-xl bg-slate-950 p-3 text-xs leading-relaxed text-slate-100">
                      {(firstFinding.excerpt ?? []).map((ln) => (
                        <div key={ln.line} className={`flex gap-3 px-1 ${ln.line >= firstFinding.startLine && ln.line <= firstFinding.endLine ? "bg-rose-500/20" : ""}`}>
                          <span className="w-6 shrink-0 select-none text-right text-slate-500">{ln.line}</span>
                          <code className="whitespace-pre">{ln.text}</code>
                        </div>
                      ))}
                    </pre>
                  </div>
                )}

                {relatedIncident && (
                  <Link href={`/incidents/${relatedIncident.id}`} className="block rounded-xl border border-rose-800/60 bg-rose-950/40 p-3 hover:border-rose-700">
                    <p className="text-[10px] font-semibold text-rose-400">RELATED INCIDENT</p>
                    <p className="mt-1 text-sm font-medium text-slate-100">{relatedIncident.title}</p>
                    <p className="text-xs text-slate-500">Risk {relatedIncident.riskScore ?? 0}/100 · View incident</p>
                  </Link>
                )}

                <Link href={`/websites/${topFile.siteId}/files/${topFile.id}`} className="inline-flex items-center gap-2 text-sm text-teal-400 hover:underline">
                  <Pin size={14} /> Open full inspection
                </Link>
              </div>
            )}
          </Panel>
        </div>
      </div>

      {/* Recent Activity is the last thing on the page: routine maintenance and
          benign events live here, deliberately separated from the criticals at
          the top so nothing important is diluted by noise. */}
      <Panel title="Recent Activity" action={<Link href="/events" className="text-xs text-teal-400 hover:underline">All events</Link>}>
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            {data.recentActivity.length === 0 ? (
              <p className="text-sm text-slate-500">No activity recorded yet.</p>
            ) : (
              <ul className="space-y-2">
                {data.recentActivity.map((a, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm">
                    <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${a.tone === "ok" ? "bg-emerald-500" : "bg-slate-500"}`} />
                    <span className="text-slate-300">{a.text}</span>
                    <span className="ml-auto shrink-0 text-xs text-slate-500">{a.time}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Routine maintenance
            </p>
            {routine.length === 0 ? (
              <p className="text-sm text-slate-500">No routine maintenance recorded.</p>
            ) : (
              <ul className="space-y-2">
                {routine.map((r) => (
                  <li key={r.id}>
                    <Link href={`/incidents/${r.id}`} className="flex items-start gap-3 text-sm hover:text-teal-300">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500" />
                      <span className="text-slate-400">{r.title}</span>
                      <span className="ml-auto shrink-0 text-xs text-slate-600">{timeAgo(r.startedAt, now)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs leading-relaxed text-slate-600">
              Routine updates and expected changes are informational. They are never mixed into the items that need
              attention above.
            </p>
          </div>
        </div>
      </Panel>
    </div>
  );
}
