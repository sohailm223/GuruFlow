import Link from "next/link";
import { notFound } from "next/navigation";
import { getIncidentById, getSiteById } from "@/lib/blackbox/storage";
import IncidentHeader from "@/app/components/blackbox/IncidentHeader";
import LikelyCause from "@/app/components/blackbox/LikelyCause";
import AttackChain from "@/app/components/blackbox/AttackChain";
import ImpactSummary from "@/app/components/blackbox/ImpactSummary";
import EvidenceList from "@/app/components/blackbox/EvidenceList";
import IncidentTimeline from "@/app/components/blackbox/IncidentTimeline";
import DetectorFindings from "@/app/components/blackbox/DetectorFindings";
import DevDiagnostics from "@/app/components/blackbox/DevDiagnostics";
import IncidentStatusControl from "@/app/components/blackbox/IncidentStatusControl";
import SuspiciousFileEvidence from "@/app/components/blackbox/files/SuspiciousFileEvidence";
import EntryPointPanel from "@/app/components/blackbox/EntryPointPanel";
import AffectedAreas from "@/app/components/blackbox/AffectedAreas";
import HowToFix from "@/app/components/blackbox/HowToFix";
import VerifyRepair from "@/app/components/blackbox/VerifyRepair";
import PreventAgain from "@/app/components/blackbox/PreventAgain";
import { formatClock, formatDay } from "@/lib/blackbox/schemas";

export const dynamic = "force-dynamic";

/**
 * Incident detail.
 *
 * Structured as the five questions a non-security person actually asks:
 *   1 What happened            — verdict, chain, evidence
 *   2 How it probably happened — likely entry point, hedged
 *   3 What was affected        — including what is unknown or unmonitored
 *   4 How to fix it            — prioritised, guided, and verified afterwards
 *   5 How to prevent it again  — hardening
 *
 * Nothing on this page modifies the customer website.
 */
export default async function IncidentDetailPage({ params }) {
  const { id } = await params;

  const incident = await getIncidentById(id);
  if (!incident) notFound();

  const site = await getSiteById(incident.siteId);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/incidents" className="text-sm text-slate-500 hover:text-slate-800">
            ← Incidents
          </Link>
          {site && (
            <Link
              href={`/websites/${site.id}/events?incident=${incident.id}`}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              View {incident.eventCount} raw event{incident.eventCount === 1 ? "" : "s"} →
            </Link>
          )}
        </div>
        <p className="text-xs text-slate-400">
          {formatDay(incident.startedAt)} · {formatClock(incident.startedAt)} –{" "}
          {formatClock(incident.endedAt)} · {incident.id}
        </p>
      </div>

      <IncidentHeader incident={incident} siteName={site?.name} />

      <div className="rounded-xl border border-slate-200 bg-white px-6 py-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Status</p>
        <IncidentStatusControl
          incidentId={incident.id}
          status={incident.status}
          falsePositiveReason={incident.falsePositiveReason}
          notes={incident.notes ?? []}
        />
      </div>

      {/* 1 ── WHAT HAPPENED */}
      <Section n={1} title="What Happened">
        <LikelyCause incident={incident} />
        <SuspiciousFileEvidence incident={incident} />
        <AttackChain incident={incident} />
        <IncidentTimeline incident={incident} />
        <EvidenceList incident={incident} />
        <DetectorFindings incident={incident} />
      </Section>

      {/* 2 ── HOW IT PROBABLY HAPPENED */}
      <Section n={2} title="How It Probably Happened" note="A probable path, not a proven one.">
        <EntryPointPanel incident={incident} />
      </Section>

      {/* 3 ── WHAT WAS AFFECTED */}
      <Section n={3} title="What Was Affected">
        <ImpactSummary incident={incident} />
        <AffectedAreas incident={incident} />
      </Section>

      {/* 4 ── HOW TO FIX IT */}
      <Section n={4} title="How to Fix It" note="ScanSite guides the fix; it never applies it." id="how-to-fix">
        <HowToFix incident={incident} siteId={incident.siteId} />
        <VerifyRepair
          incidentId={incident.id}
          initial={incident.verification ?? null}
          initialStatus={incident.remediationStatus ?? "not_started"}
        />
      </Section>

      {/* 5 ── HOW TO PREVENT IT AGAIN */}
      <Section n={5} title="How to Prevent It Again">
        <PreventAgain incident={incident} />
      </Section>

      {/* Diagnostics are for development only: they expose the internal
          grouping, scoring and detector numbers behind the verdict. */}
      {process.env.NODE_ENV === "development" ? <DevDiagnostics incident={incident} /> : null}

      <p className="pb-4 text-xs text-slate-400">
        Analysis is deterministic — produced by ScanSite&apos;s detectors, not an
        AI service. Raw internal score {incident.rawScore}.
      </p>
    </div>
  );
}

function Section({ n, title, note, id, children }) {
  return (
    <div id={id}>
      <div className="mb-3 flex flex-wrap items-baseline gap-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
          {n}
        </span>
        <h2 className="text-base font-semibold uppercase tracking-wide text-slate-700">{title}</h2>
        {note && <p className="text-xs text-slate-400">{note}</p>}
      </div>
      <div className="space-y-6">{children}</div>
    </div>
  );
}
