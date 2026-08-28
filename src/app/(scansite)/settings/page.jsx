import { ShieldCheck, ShieldOff } from "lucide-react";
import { adminConfigured, adminUsername } from "@/lib/blackbox/gate";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const gateOn = adminConfigured();
  const username = adminUsername();

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
      </div>
    </div>
  );
}
