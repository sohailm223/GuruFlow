'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home } from 'lucide-react';
import { usePageTitle } from '@/context/PageTitleContext';

const toTitleCase = (str) =>
  str.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export default function Breadcrumbs() {
  const pathname = usePathname();
  const { title } = usePageTitle();

  const segments = pathname.split('/').filter(Boolean);

  // Build cumulative paths: /project, /project/battleoftheteal
  const paths = segments.map((_, i) => '/' + segments.slice(0, i + 1).join('/'));

  return (
    <nav className="mb-4 flex items-center gap-2 text-sm text-slate-500">
      {/* Home */}
      <Link
        href="/"
        className="flex items-center gap-1 hover:text-slate-900"
      >
        <Home size={14} />
        Home
      </Link>

      {segments.map((seg, index) => {
        const isLast = index === segments.length - 1;

        // 🔥 Use entity name from title for last segment
        let label = toTitleCase(seg);
        if (isLast && title.includes(':')) {
          label = title.split(':')[1].trim();
        }

        return (
          <span key={paths[index]} className="flex items-center gap-2">
            <span>›</span>

            {isLast ? (
              // Current page → NOT clickable
              <span className="font-medium text-slate-900">
                {label}
              </span>
            ) : (
              // Parent segments → clickable
              <Link
                href={paths[index]}
                className="hover:text-slate-900"
              >
                {label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
