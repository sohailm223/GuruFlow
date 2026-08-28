"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { LayoutGrid, Globe, ShieldAlert } from "lucide-react";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutGrid, exact: true },
  { href: "/websites", label: "Websites", icon: Globe },
  { href: "/incidents", label: "Incidents", icon: ShieldAlert },
];

export default function ScanSiteLayout({ children }) {
  const pathname = usePathname();
  const isActive = (item) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href);

  return (
    <div className="min-h-screen bg-slate-50">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[240px] flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex h-16 items-center gap-3 border-b border-slate-200 px-6">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-teal-700 text-sm font-semibold text-white">
            S
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">ScanSite</p>
            <p className="truncate text-xs text-slate-500">Black Box</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
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
                    ? "bg-teal-50 text-teal-800"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                )}
              >
                <Icon size={17} className={active ? "text-teal-700" : "text-slate-400"} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 px-6 py-4">
          <p className="text-xs leading-relaxed text-slate-500">
            Know exactly what happened to your website.
          </p>
        </div>
      </aside>

      <header className="sticky top-0 z-40 flex h-14 items-center border-b border-slate-200 bg-white px-4 lg:hidden">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-teal-700 text-xs font-semibold text-white">
            S
          </span>
          <span className="text-sm font-semibold text-slate-900">ScanSite Black Box</span>
        </Link>
      </header>

      <main className="px-4 pb-24 pt-6 sm:px-6 lg:ml-[240px] lg:px-8 lg:pb-10">
        <div className="mx-auto w-full max-w-6xl">{children}</div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-slate-200 bg-white lg:hidden">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = isActive(item);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "flex flex-1 flex-col items-center gap-1 py-3 text-[11px] font-medium",
                active ? "text-teal-700" : "text-slate-500"
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
