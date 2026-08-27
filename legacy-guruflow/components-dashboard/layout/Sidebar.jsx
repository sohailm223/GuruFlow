'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { navItems } from '../navItems';

export default function Sidebar() {
  const pathname = usePathname();

  const isActive = (href) =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <aside className="fixed inset-y-0 left-0 z-40 w-[280px] border-r border-slate-200 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <div className="flex h-screen flex-col px-6 py-6">

        {/* Logo */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="h-10 w-10 rounded-xl bg-emerald-400/20 ring-1 ring-emerald-300/30 grid place-items-center">
            <span className="text-lg font-semibold text-emerald-200">G</span>
          </div>
          <div>
            <h3 className="text-lg font-semibold tracking-wide">GurusFlow</h3>
            <p className="text-xs text-slate-400">Project Intelligence</p>
          </div>
        </div>

        {/* Scrollable Nav */}
        <div className="mt-8 flex-1 overflow-y-auto">
          <nav className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={clsx(
                    'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
                    active
                      ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/30'
                      : 'text-slate-100 hover:bg-white/10'
                  )}
                >
                  <Icon
                    size={18}
                    className={clsx(
                      active
                        ? 'text-emerald-300'
                        : 'text-slate-400 group-hover:text-slate-200'
                    )}
                  />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Footer (always bottom) */}
        <div className="mt-auto shrink-0 rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-sm font-medium">Need help onboarding?</p>
          <p className="mt-1 text-xs text-slate-400">
            Invite teammates and set project roles in minutes.
          </p>
          <Link
            href="/onboarding"
            className="mt-3 inline-flex items-center justify-center rounded-md bg-emerald-400/90 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-300"
          >
            Start onboarding
          </Link>
        </div>

      </div>
    </aside>
  );
}
