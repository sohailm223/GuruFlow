import Link from "next/link";
import { ShieldCheck, FilePen, FileQuestion, OctagonAlert, ArrowRight } from "lucide-react";
import { getSites, getFiles } from "@/lib/blackbox/storage";
import { timeAgo, nowMs } from "@/lib/blackbox/sites";

export const dynamic = "force-dynamic";

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

const RISK_TONE = (r) =>
  r >= 80 ? "text-rose-400" : r >= 60 ? "text-orange-400" : r >= 40 ? "text-amber-400" : "text-emerald-400";

export default async function FileIntegrityPage() {
  const [sites, files] = await Promise.all([getSites(), getFiles()]);
  const now = nowMs();
  const agg = { checked: files.length, verified: 0, changed: 0, suspicious: 0, critical: 0 };
  for (const f of files) agg[BUCKET[f.integrityStatus] ?? "changed"]++;
  const flagged = files
    .filter((f) => f.integrityStatus === "suspicious" || f.integrityStatus === "critical" || (f.riskScore ?? 0) >= 40)
    .sort((a, b) => (b.riskScore ?? 0) - (a.riskScore ?? 0));
  const siteName = (id) => sites.find((s) => s.id === id)?.name ?? id;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-100">File Integrity</h1>
        <p className="mt-1 text-sm text-slate-500">See which files changed, which are new, and which need inspection.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          [ShieldCheck, "Verified", agg.verified, "text-emerald-400"],
          [FilePen, "Changed", agg.changed, "text-amber-400"],
          [FileQuestion, "Suspicious", agg.suspicious, "text-orange-400"],
          [OctagonAlert, "Critical", agg.critical, "text-rose-400"],
        ].map(([Icon, label, value, tone]) => (
          <div key={label} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
            <Icon size={18} className={tone} />
            <p className="mt-2 text-2xl font-semibold text-slate-100">{value.toLocaleString()}</p>
            <p className="text-xs text-slate-500">{label}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60">
        <div className="border-b border-slate-800 px-5 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Flagged Files</p>
        </div>
        <div className="divide-y divide-slate-800/60">
          {flagged.length === 0 ? (
            <p className="p-5 text-sm text-slate-500">No flagged files. Connect a site and run a scan to build a baseline.</p>
          ) : (
            flagged.map((f) => (
              <Link
                key={f.id}
                href={`/websites/${f.siteId}/files/${f.id}`}
                className="flex items-center justify-between gap-3 p-4 hover:bg-slate-900/40"
              >
                <div className="min-w-0">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                      f.integrityStatus === "critical" ? "bg-rose-500/10 text-rose-400" : "bg-orange-500/10 text-orange-400"
                    }`}
                  >
                    {f.integrityStatus.toUpperCase()}
                  </span>
                  <p className="mt-1 truncate text-sm text-slate-200">{f.relativePath}</p>
                  <p className="text-xs text-slate-500">{siteName(f.siteId)} · {timeAgo(f.modifiedAt, now)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-lg font-semibold ${RISK_TONE(f.riskScore ?? 0)}`}>{f.riskScore ?? 0}/100</span>
                  <ArrowRight size={15} className="text-slate-500" />
                </div>
              </Link>
            ))
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60">
        <div className="border-b border-slate-800 px-5 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Sites</p>
        </div>
        <div className="divide-y divide-slate-800/60">
          {sites.map((s) => {
            const mine = files.filter((f) => f.siteId === s.id);
            const crit = mine.filter((f) => f.integrityStatus === "critical").length;
            return (
              <Link key={s.id} href={`/websites/${s.id}/files`} className="flex items-center justify-between p-4 hover:bg-slate-900/40">
                <div>
                  <p className="text-sm font-medium text-slate-200">{s.name}</p>
                  <p className="text-xs text-slate-500">{mine.length} files tracked</p>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  {crit ? <span className="text-rose-400">{crit} critical</span> : <span className="text-emerald-400">Verified</span>}
                  <ArrowRight size={15} className="text-slate-500" />
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
