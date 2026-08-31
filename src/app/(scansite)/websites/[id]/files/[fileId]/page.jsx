import Link from "next/link";
import { notFound } from "next/navigation";
import { getFileById, getIncidentsBySite, getEventsBySite } from "@/lib/blackbox/storage";
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
  const siteEvents = await getEventsBySite(id, 500);
  const wanted = new Set(file.relatedEvents ?? []);
  const relatedEvents = wanted.size
    ? siteEvents.filter((e) => wanted.has(e.eventId ?? e.id))
    : siteEvents.filter((e) => e.path === file.path || e.metadata?.file?.relativePath === file.relativePath);
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
          <Meta label="Last seen" value={file.lastSeenAt ? formatClock(file.lastSeenAt) : "—"} />
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

      {/* Detection signals — always shown, even when the collector reported no
          code-level signals, because the integrity signals still explain the
          risk. An empty state is honest; a missing section is not. */}
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
          {integritySignals(file).map((s) => (
            <li key={s.text} className="flex items-start gap-3 text-sm">
              <SevDot severity={s.severity} />
              <span className="text-slate-700">{s.text}</span>
            </li>
          ))}
          {(file.codeFindings ?? []).length === 0 &&
            (file.signals ?? []).length === 0 &&
            integritySignals(file).length === 0 && (
              <li className="text-sm text-slate-500">
                No code-level signals were reported for this file — integrity metadata only.
              </li>
            )}
        </ul>
      </section>

      {/* Suspicious code with line-level evidence */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-700">Suspicious code</h2>
        <CodeEvidence findings={file.codeFindings ?? []} />
        <p className="mt-2 text-xs leading-relaxed text-slate-500">
          These excerpts are the only code ScanSite ever sees: the collector reports matched lines from the WordPress
          server. ScanSite does not download whole files, does not execute them, and does not read the rest of the
          file.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Metadata */}
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">File metadata</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <Row k="Status" v={STATUS_LABEL[file.integrityStatus] ?? file.integrityStatus} />
            <Row k="SHA-256" v={file.sha256} mono />
            <Row k="Previous SHA-256" v={file.previousSha256} mono />
            <Row k="Size" v={`${(file.size ?? 0).toLocaleString()} B`} />
            <Row k="First seen" v={file.firstSeenAt ? formatClock(file.firstSeenAt) : null} />
            <Row k="Last seen" v={file.lastSeenAt ? formatClock(file.lastSeenAt) : null} />
            <Row k="Last modified" v={file.modifiedAt ? timeAgo(file.modifiedAt, now) : null} />
            <Row k="Extension" v={`.${file.extension}`} />
            <Row k="Category" v={file.category} />
            <Row
              k="Trusted"
              v={
                file.trustedExpired
                  ? "Was trusted — trust expired because the hash changed"
                  : file.trusted
                    ? "Yes — path + SHA-256 match a trusted entry"
                    : "No"
              }
            />
            <Row k="Source code analysis" v="Not performed" />
          </dl>
          <p className="mt-3 text-xs leading-relaxed text-slate-500">
            Source code analysis is not performed: ScanSite never uploads file contents and never runs them. Everything
            above comes from on-server metadata (path, size, hash, timestamps) plus the collector&apos;s static
            pattern findings.
          </p>

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

      {/* Related events — the collector activity that produced this record */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
          Related events ({relatedEvents.length})
        </h2>
        {relatedEvents.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">
            No recorded events reference this file. The record came from a file inventory report.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {relatedEvents.slice(0, 12).map((e) => (
              <li key={e.eventId ?? e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2 text-sm">
                <span className="font-medium text-slate-700">{(e.type ?? "event").replace(/_/g, " ")}</span>
                <span className="text-xs text-slate-400">{formatClock(e.timestamp)}</span>
                {e.actor?.username ?? (typeof e.actor === "string" ? e.actor : null) ? (
                  <span className="text-xs text-slate-500">
                    actor {e.actor?.username ?? e.actor}
                  </span>
                ) : null}
                {e.path ? <span className="break-all font-mono text-xs text-slate-400">{e.path}</span> : null}
                <Link
                  href={`/websites/${id}/events`}
                  className="ml-auto text-xs font-medium text-slate-500 hover:text-slate-800"
                >
                  Open events →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * Signals derivable from integrity metadata alone, so the section still
 * explains the risk when the collector reported no code-level findings.
 */
function integritySignals(file) {
  const out = [];
  if (file.category === "uploads" && file.extension === "php") {
    out.push({ severity: "critical", text: "Executable extension inside a data-only directory (uploads)" });
  }
  if (file.integrityStatus === "critical" || file.integrityStatus === "suspicious") {
    out.push({ severity: "high", text: `Integrity status: ${STATUS_LABEL[file.integrityStatus] ?? file.integrityStatus}` });
  } else if (file.integrityStatus) {
    out.push({ severity: "low", text: `Integrity status: ${STATUS_LABEL[file.integrityStatus] ?? file.integrityStatus}` });
  }
  if (file.integrityStatus === "new") {
    out.push({ severity: "medium", text: "New since the integrity baseline" });
  }
  if (file.previousSha256) {
    out.push({ severity: "medium", text: "SHA-256 changed since this file was last seen" });
  }
  if (file.trustedExpired) {
    out.push({ severity: "high", text: "Was trusted — trust expired because the hash changed" });
  } else if (file.trusted) {
    out.push({ severity: "low", text: "Matches a trusted path + SHA-256 entry" });
  }
  return out;
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
