'use client';

import React from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';

const IDLE_MS = 10 * 60 * 1000; // 10 minutes

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const r = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [user, setUser] = React.useState<User | null | undefined>(undefined);

  // auth subscribe once
  React.useEffect(() => onAuthStateChanged(auth, setUser), []);

  // idle + tab-close signout
  React.useEffect(() => {
    if (!user) return;

    let timer: any;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        try { await signOut(auth); } finally {
          r.replace('/login?reason=idle');
        }
      }, IDLE_MS);
    };

    const evts = ['mousemove','keydown','click','scroll','touchstart','visibilitychange'];
    evts.forEach(e => window.addEventListener(e, reset, { passive: true }));
    reset();

    const onClose = async () => {
      try { await signOut(auth); } catch {}
    };
    window.addEventListener('beforeunload', onClose);

    return () => {
      evts.forEach(e => window.removeEventListener(e, reset));
      window.removeEventListener('beforeunload', onClose);
      clearTimeout(timer);
    };
  }, [user, r]);

  // while unknown
  if (user === undefined) {
    return (
      <div className="min-h-screen grid place-items-center text-sm text-gray-500">
        Loading…
      </div>
    );
  }

  // not signed in -> go to login (remember where you were)
  if (!user) {
    const to = '/login';
    const qs = search?.toString();
    r.replace(qs ? `${to}?${qs}` : to);
    return null;
  }

  return <>{children}</>;
}
