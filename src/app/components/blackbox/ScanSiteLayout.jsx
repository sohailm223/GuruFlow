"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import clsx from "clsx";
import {
  LayoutGrid,
  Globe,
  ShieldAlert,
  Activity,
  FileCheck2,
  Cable,
  Cpu,
  Settings,
  Box,
  CircleCheck,
  CircleDashed,
  LogOut,
} from "lucide-react";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutGrid, exact: true },
  { href: "/websites", label: "Websites", icon: Globe },
  { href: "/incidents", label: "Incidents", icon: ShieldAlert },
  { href: "/events", label: "Events", icon: Activity },
  { href: "/files", label: "File Integrity", icon: FileCheck2, badge: "NEW" },
  { href: "/connection", label: "Connection", icon: Cable },
  { href: "/environment", label: "Environment", icon: Cpu },
  { href: "/settings", label: "Settings", icon: Settings },
];

function CollectorStatus() {
  const [state, setState] = useState({ total: 0, connected: 0, loaded: false });

  useEffect(() => {
    let alive = true;
    fetch("/api/blackbox/sites")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d) return;
        const sites = Array.isArray(d.sites) ? d.sites : [];
        setState({ total: sites.length, connected: sites.filter((s) => s.collector?.key === "connected").length, loaded: true });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const all = state.loaded && state.total > 0 && state.connected === state.total;
  return (
    <div className="mx-3 mb-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Collector Status</p>
      <div className="mt-2 flex items-center gap-2">
        {all ? <CircleCheck size={16} className="text-emerald-400" /> : <CircleDashed size={16} className="text-amber-400" />}
        <span className="text-sm font-medium text-slate-200">{all ? "Connected" : state.total ? "Degraded" : "Idle"}</span>
      </div>
      <p className="mt-1 text-[11px] text-slate-500">
        {state.loaded ? `${state.connected} of ${state.total} collectors online` : "Checking collectors…"}
      </p>
    </div>
  );
}

export default function ScanSiteLayout({ children }) {
  const pathname = usePathname();
  const isActive = (item) => (item.exact ? pathname === item.href : pathname.startsWith(item.href));

  return (
    <div className="min-h-screen bg-slate-950">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[248px] flex-col border-r border-slate-800 bg-slate-950 lg:flex">
        <div className="flex h-16 items-center gap-3 px-5">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-teal-600 text-white">
            <Box size={20} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-100">ScanSite</p>
            <p className="truncate text-xs text-slate-500">Black Box</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = isActive(item);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={clsx(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
                  active
                    ? "bg-teal-500/10 text-teal-300"
                    : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
                )}
              >
                <Icon size={17} className={active ? "text-teal-400" : "text-slate-500"} />
                <span className="flex-1">{item.label}</span>
                {item.badge && (
                  <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}

          <SignOutButton />
        </nav>

        <CollectorStatus />

        <div className="border-t border-slate-800 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-slate-800 text-sm font-semibold text-slate-200">S</div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-200">ScanSite Admin</p>
              <p className="truncate text-xs text-slate-500">Administrator</p>
            </div>
          </div>
        </div>
      </aside>

      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-slate-800 bg-slate-950 px-4 lg:hidden">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-teal-600 text-white"><Box size={16} /></span>
          <span className="text-sm font-semibold text-slate-100">ScanSite Black Box</span>
        </Link>
      </header>

      <main className="px-4 pb-24 pt-6 sm:px-6 lg:ml-[248px] lg:px-8 lg:pb-10">
        <div className="mx-auto w-full max-w-[1400px]">{children}</div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 flex overflow-x-auto border-t border-slate-800 bg-slate-950 lg:hidden">
        {NAV.slice(0, 5).map((item) => {
          const Icon = item.icon;
          const active = isActive(item);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "flex flex-1 flex-col items-center gap-1 px-2 py-2 text-[10px] font-medium",
                active ? "text-teal-400" : "text-slate-500"
              )}
            >
              <Icon size={18} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

/** Ends the local admin session; the action lands in the audit log. */
function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const signOut = async () => {
    setBusy(true);
    try {
      await fetch("/api/blackbox/logout", { method: "POST" });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  };

  return (
    <button
      onClick={signOut}
      disabled={busy}
      className="mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-900 hover:text-slate-200 disabled:opacity-50"
    >
      <LogOut size={17} className="text-slate-500" />
      <span className="flex-1 text-left">Sign out</span>
    </button>
  );
}
