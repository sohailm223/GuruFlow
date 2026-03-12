'use client';

import { usePageTitle } from '@/context/PageTitleContext';

export default function PageTitle() {
  const { title } = usePageTitle();

  return (
    <h1 className="text-2xl font-semibold text-slate-900 mb-4">
      {title}
    </h1>
  );
}
