import Link from "next/link";
import { notFound } from "next/navigation";
import { getFileById, getIncidentsBySite } from "@/lib/blackbox/storage";
import { relatedIncidents, levelFor, STATUS_LABEL } from "@/lib/blackbox/files/model";
import { timeAgo, nowMs } from "@/lib/blackbox/sites";
import { formatClock } from "@/lib/blackbox/schemas";
import FileRiskBadge from "@/app/components/blackbox/files/FileRiskBadge";
import CodeEvidence from "@/app/components/blackbox/files/CodeEvidence";

export const dynamic = "force-dynamic";

export default async function FileInspectPage({ params }) {
  const { id, fileId } = await params;

  const file = await getFileById(id, fileId);
  if (!file) notFound();

  const incidents = await getIncidentsBySite(id, 100);
  const related = relatedIncidents(file, incidents);
  const now = nowMs();
  const level = levelFor(file.riskScore ?? 0);

  return (
    <div className="space-y-8">
      <header>
        <Link href={`/websites/${id}/files`} className="text-sm text-slate-500 hover:text-slate-800">
          ← File Integrity
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <p className="text-xs font-bold uppercase tracking-wider text-rose-700">
            {level.key === "critical" ? "Suspicious file" : "File"}
          </p>
          <FileRiskBadge level={level} risk={file.riskScore} />
        </div>
        <h1 className="mt-1 font-mono text-2xl font-semibold tracking-tight text-slate-100">{file.filename}</h1>
        <p className="break-all font-mono text-sm text-slate-500">/{file.relativePath}</p>

        <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Meta label="Confidence" value={`${file.confidence}%`} />
          <Meta label="First seen" value={file.firstSeenAt ? formatClock(file.firstSeenAt) : "—"} />
          <Meta label="Last modified" value={file.modifiedAt ? timeAgo(file.modifiedAt, now) : "—"} />
          <Meta label="Size" value={`${(file.size ?? 0).toLocaleString()} B`} />
        </div>
      </header>

      {/* Primary explanation */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
          Why ScanSite flagged this file
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">{whyFlagged(file)}</p>
      </section>

      {/* Detection signals */}
      {(file.signals ?? []).length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Detection signals</h2>
          <ul className="mt-3 space-y-2">
            {(file.codeFindings ?? []).map((f, i) => (
              <li key={f.id ?? i} className="flex items-start gap-3 text-sm">
                <SevDot severity={f.severity} />
                <span className="text-slate-700">
                  <span className="font-medium">{f.label}</span>
                  <span className="ml-2 font-mono text-xs text-slate-400">line {f.startLine}{f.endLine !== f.startLine ? `–${f.endLine}` : ""}</span>
                </span>
              </li>
            ))}
            {(file.signals ?? []).filter((s) => !(file.codeFindings ?? []).some((f) => f.label === s)).map((s) => (
              <li key={s} className="flex items-start gap-3 text-sm">
                <SevDot severity="medium" />
                <span className="text-slate-700">{s}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Suspicious code with line-level evidence */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-700">Suspicious code</h2>
        <CodeEvidence findings={file.codeFindings ?? []} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Metadata */}
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">File metadata</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <Row k="Status" v={STATUS_LABEL[file.integrityStatus] ?? file.integrityStatus} />
            <Row k="SHA-256" v={file.sha256} mono />
            <Row k="Previous SHA-256" v={file.previousSha256} mono />
            <Row k="Extension" v={`.${file.extension}`} />
            <Row k="Category" v={file.category} />
          </dl>

          {(file.history ?? []).length > 0 && (
            <>
              <h3 className="mt-5 text-sm font-semibold uppercase tracking-wide text-slate-700">File history</h3>
              <ul className="mt-2 space-y-1 text-sm text-slate-600">
                {(file.history ?? []).map((h, i) => (
                  <li key={i}>
                    {formatClock(h.at)} — {STATUS_LABEL[h.status] ?? h.status} · <span className="font-mono text-xs">{(h.sha256 ?? "").slice(0, 12)}…</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        {/* Related incident + recommended response */}
        <section className="space-y-6">
          {related[0] && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-rose-700">Related incident</h2>
              <p className="mt-2 text-base font-semibold text-slate-900">{related[0].title}</p>
              <p className="text-sm text-slate-600">Risk {related[0].riskScore}/100</p>
              <Link href={`/incidents/${related[0].id}`} className="mt-3 inline-block rounded-lg bg-rose-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-rose-700">
                View Incident
              </Link>
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Recommended response</h2>
            <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-slate-600">
              <li>Verify whether this file is expected on this website.</li>
              <li>Compare it against a trusted clean source.</li>
              <li>Review any administrator account created shortly before it.</li>
              <li>Review related cron activity.</li>
              <li>Run a complete file integrity scan.</li>
            </ol>
          </div>
        </section>
      </div>
    </div>
  );
}

function whyFlagged(file) {
  const parts = [];
  if (file.category === "uploads" && file.extension === "php") {
    parts.push("This PHP file appeared inside the uploads directory, where executable code does not belong.");
  } else if (file.integrityStatus === "new") {
    parts.push("This file is new since the integrity baseline.");
  } else if (file.integrityStatus === "modified" || file.integrityStatus === "suspicious") {
    parts.push("This known file changed outside of an expected update window.");
  }
  if ((file.codeFindings ?? []).some((f) => f.type === "decode_decompress_execute")) {
    parts.push("Encoded content is decoded, decompressed and passed to dynamic PHP execution.");
  } else if ((file.signals ?? []).length) {
    parts.push(`It shows: ${(file.signals ?? []).slice(0, 3).join(", ").toLowerCase()}.`);
  }
  return parts.join(" ") || "This file deviates from the site's expected state.";
}

function SevDot({ severity }) {
  const c = { critical: "bg-rose-600", high: "bg-orange-500", medium: "bg-amber-500", low: "bg-sky-500" }[severity] ?? "bg-slate-400";
  return <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${c}`} />;
}

function Meta({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function Row({ k, v, mono }) {
  return (
    <div className="flex gap-3">
      <dt className="w-36 shrink-0 text-slate-500">{k}</dt>
      <dd className={`break-all text-slate-700 ${mono ? "font-mono text-xs" : ""}`}>{v ?? "—"}</dd>
    </div>
  );
}
