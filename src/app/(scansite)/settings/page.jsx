import { ShieldCheck, ShieldOff, ScrollText, TriangleAlert } from "lucide-react";
import { adminConfigured, adminUsername } from "@/lib/blackbox/gate";
import { getAudit, storageInfo } from "@/lib/blackbox/storage";

export const dynamic = "force-dynamic";

/** Human label per audit action — keeps the log readable without a lookup table in storage. */
const ACTION_LABEL = {
  login: "Admin signed in",
  login_failed: "Failed sign-in attempt",
  site_added: "Website added",
  site_deleted: "Website deleted",
  site_disconnected: "Website disconnected",
  site_reconnected: "Website reconnected",
  key_rotation_requested: "Collector key rotation requested",
  key_rotation: "Collector key rotated",
  incident_status: "Incident status changed",
  incident_note: "Incident note added",
  incident_false_positive: "Incident marked false positive",
  trusted_file_added: "File trusted",
  trusted_file_removed: "Trusted file removed",
  trusted_file_expired: "Trusted file expired (hash changed)",
};

function entryDetail(entry) {
  const bits = [];
  if (entry.siteId) bits.push(entry.siteId);
  if (entry.siteName) bits.push(entry.siteName);
  if (entry.status) bits.push(`→ ${String(entry.status).replace(/_/g, " ")}`);
  if (entry.path) bits.push(entry.path);
  if (entry.reason) bits.push(entry.reason);
  if (entry.falsePositiveReason) bits.push(entry.falsePositiveReason);
  if (entry.actor) bits.push(`by ${entry.actor}`);
  if (entry.ip) bits.push(entry.ip);
  return bits.join(" · ");
}

export default async function SettingsPage() {
  const gateOn = adminConfigured();
  const username = adminUsername();
  const audit = await getAudit(15);
  const storage = storageInfo();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-100">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">Deployment-level configuration for this ScanSite instance.</p>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex items-center gap-3">
          {gateOn ? <ShieldCheck size={20} className="text-emerald-400" /> : <ShieldOff size={20} className="text-amber-400" />}
          <div>
            <p className="text-sm font-medium text-slate-200">Local admin login (mandatory)</p>
            <p className="text-xs text-slate-500">
              {gateOn
                ? `Enabled — sign in as “${username}”. Every page and management API requires a session.`
                : "Not configured — the dashboard is locked until SCANSITE_ADMIN_PASSWORD is set on the server."}
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 text-sm text-slate-400">
        <p className="font-medium text-slate-200">Storage</p>
        <p className="mt-1 text-xs leading-relaxed">
          This build persists to local JSON on the host&apos;s disk. For a public deployment, run it on a host with
          persistent storage and keep the access gate enabled; serverless platforms lose the JSON between requests.
        </p>
        <dl className="mt-3 grid gap-1 text-xs sm:grid-cols-[auto_1fr]">
          <dt className="text-slate-500">Driver</dt>
          <dd className={storage.driver === "memory" ? "text-amber-300" : "text-slate-300"}>{storage.driver}</dd>
          <dt className="text-slate-500">Directory</dt>
          <dd className="break-all text-slate-300">{storage.dir}</dd>
          <dt className="text-slate-500">Writes</dt>
          <dd className="text-slate-300">Atomic (temp file + rename); previous JSON kept as a .bak backup</dd>
        </dl>
        {storage.warning ? (
          <div className="mt-3 flex gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
            <TriangleAlert size={16} className="mt-0.5 shrink-0" />
            <p>{storage.warning}</p>
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex items-center gap-3">
          <ScrollText size={18} className="text-slate-400" />
          <div>
            <p className="text-sm font-medium text-slate-200">Management audit log</p>
            <p className="text-xs text-slate-500">
              Local, append-only record of administrative actions on this ScanSite instance. It does not log collector
              traffic.
            </p>
          </div>
        </div>

        {audit.length === 0 ? (
          <p className="mt-4 text-xs text-slate-500">No administrative actions recorded yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-800/70">
            {audit.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2 text-xs">
                <span className="font-medium text-slate-200">{ACTION_LABEL[entry.action] ?? entry.action}</span>
                <span className="text-slate-500">{new Date(entry.at).toLocaleString()}</span>
                {entryDetail(entry) ? <span className="break-all text-slate-400">{entryDetail(entry)}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
