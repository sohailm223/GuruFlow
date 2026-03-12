'use client';

import { PageTitleProvider } from '@/context/PageTitleContext';
import Sidebar from '@/app/components/dashboard/layout/Sidebar';
import Header from '@/app/components/dashboard/layout/Header';
import PageTitle from '@/app/components/dashboard/layout/PageTitle';
import Breadcrumbs from '@/app/components/dashboard/layout/Breadcrumbs';
import TopLoader from '@/app/components/common/TopLoader';

import { motion, AnimatePresence } from 'framer-motion';
import { usePathname } from 'next/navigation';

export default function DashboardClient({ children }) {
  const pathname = usePathname();

  return (
    <>
      {/* Global loader */}
      <TopLoader />

      <PageTitleProvider>
        <div className="min-h-screen bg-slate-50">
          <Sidebar />

          <main className="ml-[280px] min-h-screen px-6 py-6 lg:px-8">
            <Header />
            <Breadcrumbs />
            <PageTitle />

            {/* 👇 Page transition */}
            <AnimatePresence mode="wait">
              <motion.div
                key={pathname}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
              >
                {children}
              </motion.div>
            </AnimatePresence>

          </main>
        </div>
      </PageTitleProvider>
    </>
  );
}
