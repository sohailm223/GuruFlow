'use client';
import { UserButton } from '@clerk/nextjs';

export default function Header() {
  return (
    <div className="mb-6 flex items-center justify-end border-b border-slate-200 pb-4">
      <UserButton />
      
    </div>
  );
}
