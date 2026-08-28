import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getSiteById, getFilesBySite, getIncidentsBySite, getScansBySite } from "@/lib/blackbox/storage";
import {
  fileDistribution,
  integrityScore,
  categoryBreakdown,
  attentionFiles,
  relatedIncidents,
  STATUS_LABEL,
  levelFor,
} from "@/lib/blackbox/files/model";
import { timeAgo, nowMs } from "@/lib/blackbox/sites";
import FileRiskBadge from "@/app/components/blackbox/files/FileRiskBadge";
import SuspiciousFileCard from "@/app/components/blackbox/files/SuspiciousFileCard";
import FileFilters from "@/app/components/blackbox/files/FileFilters";
import ScanControls from "@/app/components/blackbox/files/ScanControls";

export const dynamic = "force-dynamic";

export default async function FilesPage({ params, searchParams }) {
  const { id } = await params;
  const sp = await searchParams;

  const site = await getSiteById(id);
  if (!site) notFound();

  const all = await getFilesBySite(id);
  const incidents = await getIncidentsBySite(id, 100);
  const scans = await getScansBySite(id, 5);
  const now = nowMs();

  const dist = fileDistribution(all);
  const score = integrityScore(all);
  const cats = categoryBreakdown(all);
  const suspicious = attentionFiles(all);

  // Filters.
  const status = sp.status;
  const category = sp.category;
  const search = (sp.search ?? "").toLowerCase();
  let filtered = all;
  if (status) filtered = filtered.filter((f) => f.integrityStatus === status);
  if (category) filtered = filtered.filter((f) => f.category === category);
  if (search) {
    filtered = filtered.filter(
      (f) =>
        (f.filename ?? "").toLowerCase().includes(search) ||
        (f.relativePath ?? "").toLowerCase().includes(search) ||
        (f.signals ?? []).join(" ").toLowerCase().includes(search),
    );
  }
  filtered = filtered.slice(0, 100);

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/websites/${id}`} className="text-sm text-slate-500 hover:text-slate-800">
            ← {site.name}
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">File Integrity</h1>
          <p className="mt-1 text-sm text-slate-500">
            See which WordPress files changed, which are expected, and which need inspection.
          </p>
        </div>
        <ScanControls siteId={id} lastScan={scans[0] ?? null} now={now} />
      </header>

      {all.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
          <p className="text-base font-medium text-slate-900">No file integrity data yet</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
            The collector builds a hash baseline and scans in background batches. Run a scan, or
            wait for the next scheduled batch — nothing runs on visitor requests.
          </p>
        </div>
      ) : (
        <>
          {/* Score + distribution */}
          <section className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <p className="text-xs uppercase tracking-wide text-slate-400">File Integrity Score</p>
              <p className="mt-1 text-3xl font-semibold text-slate-900">{score} / 100</p>
              <p className="mt-2 text-sm text-slate-500">
                {dist.critical
                  ? `${dist.critical} critical file${dist.critical === 1 ? "" : "s"} need inspection.`
                  : "Most WordPress files match their expected state."}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-2">
              <p className="text-xs uppercase tracking-wide text-slate-400">Status distribution</p>
              <div className="mt-3 space-y-1.5">
                {Object.entries(dist)
                  .filter(([, n]) => n > 0)
                  .map(([key, n]) => (
                    <div key={key} className="flex items-center gap-3 text-sm">
                      <span className="w-24 text-slate-600">{STATUS_LABEL[key] ?? key}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded bg-slate-100">
                        <div
                          className={`h-full ${BAR[key] ?? "bg-slate-300"}`}
                          style={{ width: `${Math.max(2, (n / all.length) * 100)}%` }}
                        />
                      </div>
                      <span className="w-12 text-right tabular-nums text-slate-600">{n}</span>
                    </div>
                  ))}
              </div>
            </div>
          </section>

          {/* Category breakdown */}
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {cats.map((c) => (
              <div key={c.category} className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-slate-400">{c.category.replace("wordpress_", "core")}</p>
                <p className="mt-1 text-xl font-semibold text-slate-900">{c.checked}</p>
                <p className="text-xs text-slate-500">
                  {c.verified} verified · {c.changed} changed ·{" "}
                  <span className={c.critical ? "font-semibold text-rose-700" : ""}>{c.critical} critical</span>
                </p>
              </div>
            ))}
          </section>

          {/* Suspicious files near the top */}
          {suspicious.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-700">
                Suspicious files · {suspicious.filter((f) => f.integrityStatus === "critical").length} critical ·{" "}
                {suspicious.length} need review
              </h2>
              <div className="grid gap-4 lg:grid-cols-2">
                {suspicious.slice(0, 6).map((f) => (
                  <SuspiciousFileCard
                    key={f.id}
                    file={f}
                    siteId={id}
                    now={now}
                    relatedIncident={relatedIncidents(f, incidents)[0]}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Filterable list */}
          <section className="space-y-3">
            <Suspense fallback={null}>
              <FileFilters />
            </Suspense>
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-2.5 font-medium">File</th>
                    <th className="px-5 py-2.5 font-medium">Status</th>
                    <th className="px-5 py-2.5 font-medium">Risk</th>
                    <th className="px-5 py-2.5 font-medium">Modified</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filtered.map((f) => (
                    <tr key={f.id}>
                      <td className="px-5 py-2.5">
                        <Link href={`/websites/${id}/files/${f.id}`} className="block hover:text-rose-700">
                          <span className="font-medium text-slate-900">{f.filename}</span>
                          <span className="block break-all font-mono text-xs text-slate-400">/{f.relativePath}</span>
                        </Link>
                      </td>
                      <td className="px-5 py-2.5 text-slate-600">{STATUS_LABEL[f.integrityStatus] ?? f.integrityStatus}</td>
                      <td className="px-5 py-2.5">
                        <FileRiskBadge level={levelFor(f.riskScore ?? 0)} risk={f.riskScore} />
                      </td>
                      <td className="px-5 py-2.5 text-slate-500">{timeAgo(f.modifiedAt, now)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

const BAR = {
  verified: "bg-teal-500",
  expected: "bg-sky-400",
  modified: "bg-amber-400",
  suspicious: "bg-orange-500",
  critical: "bg-rose-600",
  new: "bg-slate-400",
  deleted: "bg-slate-300",
};
