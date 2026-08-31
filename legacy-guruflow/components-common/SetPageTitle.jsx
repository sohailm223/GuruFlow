'use client';

import { useEffect } from 'react';
import { usePageTitle } from '@/context/PageTitleContext';

export default function SetPageTitle({ title }) {
  const { setTitle } = usePageTitle();

  useEffect(() => {
    if (title) setTitle(title);
  }, [title, setTitle]);

  return null;
}
