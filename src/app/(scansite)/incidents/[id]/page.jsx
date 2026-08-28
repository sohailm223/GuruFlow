import Link from "next/link";
import { notFound } from "next/navigation";
import { getIncidentById, getSiteById } from "@/lib/blackbox/storage";
import IncidentHeader from "@/app/components/blackbox/IncidentHeader";
import LikelyCause from "@/app/components/blackbox/LikelyCause";
import AttackChain from "@/app/components/blackbox/AttackChain";
import ImpactSummary from "@/app/components/blackbox/ImpactSummary";
import EvidenceList from "@/app/components/blackbox/EvidenceList";
import RecommendedActions from "@/app/components/blackbox/RecommendedActions";
import IncidentTimeline from "@/app/components/blackbox/IncidentTimeline";
import DetectorFindings from "@/app/components/blackbox/DetectorFindings";
import IncidentStatusControl from "@/app/components/blackbox/IncidentStatusControl";
import { formatClock, formatDay } from "@/lib/blackbox/schemas";

export const dynamic = "force-dynamic";

export default async function IncidentDetailPage({ params }) {
  const { id } = await params;

  const incident = await getIncidentById(id);
  if (!incident) notFound();

  const site = await getSiteById(incident.siteId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/incidents" className="text-sm text-slate-500 hover:text-slate-800">
          ← Incidents
        </Link>
        <p className="text-xs text-slate-400">
          {formatDay(incident.startedAt)} · {formatClock(incident.startedAt)} –{" "}
          {formatClock(incident.endedAt)} · {incident.id}
        </p>
      </div>

      <IncidentHeader incident={incident} siteName={site?.name} />

      <div className="rounded-xl border border-slate-200 bg-white px-6 py-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Status</p>
        <IncidentStatusControl incidentId={incident.id} status={incident.status} />
        {incident.statusNote && (
          <p className="mt-3 text-sm text-slate-500">{incident.statusNote}</p>
        )}
      </div>

      <LikelyCause incident={incident} />
      <AttackChain incident={incident} />
      <ImpactSummary incident={incident} />
      <EvidenceList incident={incident} />
      <RecommendedActions incident={incident} />
      <IncidentTimeline incident={incident} />
      <DetectorFindings incident={incident} />

      <p className="pb-4 text-xs text-slate-400">
        Analysis is deterministic — produced by ScanSite&apos;s detectors, not an
        AI service. Raw internal score {incident.rawScore}.
      </p>
    </div>
  );
}
