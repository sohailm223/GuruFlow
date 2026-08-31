"use client";

import { useState } from "react";
import { CheckCircle2, AlertCircle, HelpCircle, RefreshCw, ShieldCheck } from "lucide-react";

const ICON = {
  resolved: <CheckCircle2 size={16} className="text-emerald-600" />,
  outstanding: <AlertCircle size={16} className="text-rose-600" />,
  not_verified: <HelpCircle size={16} className="text-slate-400" />,
};

const LABEL = {
  resolved: "Resolved",
  outstanding: "Outstanding",
  not_verified: "Not verified",
};

/**
 * Re-run verification.
 *
 * Every check reports what evidence it used. "Not verified" is shown rather than
 * a silent pass whenever ScanSite has nothing to judge on — for example when the
 * site is not reachable from this server, which is normal for sites behind a
 * firewall and is never counted as a failure or as a pass.
 */
export default function VerifyRepair({ incidentId, initial }) {
  const [verification, setVerification] = useState(initial ?? null);
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
        ScanSite re-checks each issue against evidence recorded since the incident. It changes nothing on your website;
        the only outbound request is a single fetch of your site URL to read its HTTP status.
      </p>

      {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}

      {!verification && !busy && (
        <p className="mt-4 text-sm text-slate-400">
          No verification has been run for this incident yet. Run it after you have carried out the fix steps.
        </p>
      )}

      {verification && (
        <>
          <ul className="mt-4 space-y-2">
            {verification.results.map((r) => (
              <li key={r.id} className="flex items-start gap-3 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
                <span className="mt-0.5">{ICON[r.state] ?? ICON.not_verified}</span>
                <span className="min-w-0 flex-1">
                  <span className="text-sm text-slate-800">{r.label}</span>
                  <span className="ml-2 break-all font-mono text-xs text-slate-500">{r.value}</span>
                  <span className="block text-xs text-slate-500">{r.detail}</span>
                </span>
                <span className="shrink-0 text-xs text-slate-500">{LABEL[r.state] ?? r.state}</span>
              </li>
            ))}
          </ul>

          <div className="mt-4 rounded-lg border border-slate-200 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Remediation status</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">
              {verification.resolved} / {verification.total} issues resolved
            </p>
            {verification.canResolve ? (
              <p className="mt-1 flex items-center gap-2 text-sm text-emerald-700">
                <ShieldCheck size={15} />
                Incident can be marked RESOLVED
              </p>
            ) : (
              <p className="mt-1 text-sm text-slate-600">
                {verification.outstanding} still outstanding — work through the remaining steps and verify again.
              </p>
            )}
            <p className="mt-1 text-xs text-slate-400">Checked {new Date(verification.at).toLocaleString()}</p>
          </div>
        </>
      )}
    </section>
  );
}
