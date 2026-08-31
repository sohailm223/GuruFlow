'use client';

import TopLoader from '@/app/components/common/TopLoader';

export default function ClientRoot({ children }) {
  return (
    <>
      <TopLoader />
      {children}
    </>
  );
}
