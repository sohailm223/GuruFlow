'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

const PageTitleContext = createContext(null);

// ---------- helpers ----------
const toTitleCase = (str) =>
  str.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const autoTitleFromPath = (pathname) => {
  const parts = pathname.split('/').filter(Boolean);

  if (parts.length === 0) return 'Dashboard';

  // detail page → section + entity
  if (parts.length >= 2) {
    const section = toTitleCase(parts[parts.length - 2]);
    const entity = toTitleCase(parts[parts.length - 1]);
    return `${section}: ${entity}`;
  }

  // list page
  return toTitleCase(parts[0]);
};

export function PageTitleProvider({ children }) {
  const pathname = usePathname();
  const [title, setTitle] = useState('');

  // 🔥 RESET title on every route change
  useEffect(() => {
    setTitle('');
  }, [pathname]);

  // 🔥 AUTO-generate title if page didn't set one
  useEffect(() => {
    if (!title) {
      setTitle(autoTitleFromPath(pathname));
    }
  }, [pathname, title]);

  // 🔥 Sync browser <title>
  useEffect(() => {
    if (title) {
      document.title = `${title} · GurusFlow`;
    }
  }, [title]);

  return (
    <PageTitleContext.Provider value={{ title, setTitle }}>
      {children}
    </PageTitleContext.Provider>
  );
}

export function usePageTitle() {
  const ctx = useContext(PageTitleContext);
  if (!ctx) throw new Error('usePageTitle must be used inside PageTitleProvider');
  return ctx;
}
