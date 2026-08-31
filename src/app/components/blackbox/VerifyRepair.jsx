"use client";

import { useState } from "react";
import { CheckCircle2, CircleAlert, HelpCircle, RefreshCw, ShieldCheck, EyeOff, TriangleAlert } from "lucide-react";

const ICON = {
  verified_resolved: <CheckCircle2 size={16} className="text-emerald-600" />,
  likely_resolved: <TriangleAlert size={16} className="text-amber-600" />,
  still_present: <CircleAlert size={16} className="text-rose-600" />,
  not_verified: <HelpCircle size={16} className="text-slate-400" />,
  not_monitored: <EyeOff size={16} className="text-slate-400" />,
};

const LABEL = {
  verified_resolved: "Verified resolved",
  likely_resolved: "Likely resolved",
  still_present: "Still present",
  not_verified: "Not verified",
  not_monitored: "Not monitored",
};

const STATUS_LABEL = {
  not_started: "Not started",
  in_progress: "In progress",
  partially_resolved: "Partially resolved",
  verified: "Verified",
};

/**
 * Re-run verification.
 *
 * Strong and weak evidence are reported separately: an explicit removal event
 * is `verified_resolved`, while absence from a later snapshot or a clean
 * aggregate scan is only `likely_resolved`. Anything ScanSite cannot judge is
 * `not_monitored` and is excluded from the totals, so a policy-blocked website
 * check can never be mistaken for a broken site — or for a pass.
 *
 * A verification describes a moment. If new evidence arrives afterwards the
 * result is flagged "Needs re-check" rather than continuing to show a stale
 * pass.
 */
export default function VerifyRepair({ incidentId, initial, initialStatus }) {
  const [verification, setVerification] = useState(initial ?? null);
  const [status, setStatus] = useState(initialStatus ?? "not_started");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/blackbox/incidents/${encodeURIComponent(incidentId)}/verify`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Verification failed");
      setVerification(body.verification);
      setStatus(body.incident?.remediationStatus ?? body.verification.remediationStatus);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Verify The Fix</h2>
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          <RefreshCw size={15} className={busy ? "animate-spin" : ""} />
          {busy ? "Checking…" : verification ? "Re-run verification" : "Run verification"}
        </button>
      </div>

      <p className="mt-2 text-sm text-slate-500">
        ScanSite re-checks each issue against evidence recorded since it appeared. It changes nothing on your website;
        the only outbound request is a single fetch of your registered site origin to read its HTTP status.
      </p>

      {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}

      {!verification && !busy && (
        <p className="mt-4 text-sm text-slate-400">
          No verification has been run for this incident yet. Run it after you have carried out the fix steps.
        </p>
      )}

      {verification && (
        <>
          {verification.stale && (
            <p className="mt-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <TriangleAlert size={15} className="mt-0.5 shrink-0" />
              <span>
                <span className="font-semibold">Needs re-check.</span> {verification.staleReason}
                {verification.staleEventId ? (
                  <span className="ml-2 font-mono text-xs text-amber-700">{verification.staleEventId}</span>
                ) : null}{" "}
                The result below described the site when it was run, not now.
              </span>
            </p>
          )}

          <ul className="mt-4 space-y-2">
            {verification.results.map((r) => (
              <li key={r.id} className="flex items-start gap-3 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
                <span className="mt-0.5">{ICON[r.state] ?? ICON.not_verified}</span>
                <span className="min-w-0 flex-1">
                  <span className="text-sm text-slate-800">{r.label}</span>
                  <span className="ml-2 break-all font-mono text-xs text-slate-500">{r.value}</span>
                  <span className="block text-xs text-slate-500">{r.detail}</span>
                  {r.how ? (
                    <span className="mt-0.5 block text-[11px] text-slate-400">
                      <span className="font-medium text-slate-500">How this is decided:</span> {r.how}
                    </span>
                  ) : null}
                  {r.strength === "weak" ? (
                    <span className="mt-0.5 block text-[11px] uppercase tracking-wide text-amber-700">Weak evidence</span>
                  ) : null}
                  {r.evidence ? <span className="block font-mono text-[10px] text-slate-400">{r.evidence}</span> : null}
                </span>
                <span className="shrink-0 text-xs text-slate-500">{LABEL[r.state] ?? r.state}</span>
              </li>
            ))}
          </ul>

          <div className="mt-4 rounded-lg border border-slate-200 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Remediation status</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">
              {STATUS_LABEL[status] ?? status}
              {verification.stale ? <span className="ml-2 text-sm font-normal text-amber-700">· needs re-check</span> : null}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              {verification.resolved} / {verification.total} verification checks resolved
              <span className="ml-2 text-xs text-slate-400">
                ({verification.verified} verified · {verification.likely} likely · {verification.stillPresent} still
                present · {verification.notVerified} not verified)
              </span>
            </p>
            {verification.notMonitored > 0 ? (
              <p className="mt-1 text-xs text-slate-400">
                {verification.notMonitored} check(s) ScanSite does not monitor — excluded from the count above.
              </p>
            ) : null}
            {verification.canResolve && !verification.stale ? (
              <p className="mt-1 flex items-center gap-2 text-sm text-emerald-700">
                <ShieldCheck size={15} />
                Incident can be marked RESOLVED
              </p>
            ) : null}
            <p className="mt-1 text-xs text-slate-400">
              Remediation status is tracked separately from the incident status above. Checked{" "}
              {new Date(verification.verifiedAt ?? verification.at).toLocaleString()}
            </p>
          </div>
        </>
      )}
    </section>
  );
}
