'use client';

import { useEffect, useRef } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { auth } from '@/lib/firebase';

const IDLE_MS = 10 * 60 * 1000; // 10 minutes

export default function useIdleSignout() {
  const router = useRouter();
  const timer = useRef<number | null>(null);

  const reset = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      try { await signOut(auth); } catch {}
      router.replace('/login?reason=idle');
    }, IDLE_MS);
  };

  useEffect(() => {
    const sub = onAuthStateChanged(auth, (u) => {
      if (u) reset();
      else if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
    });

    const events = ['mousemove', 'keydown', 'scroll', 'click', 'touchstart'];
    events.forEach(ev => window.addEventListener(ev, reset, { passive: true }));

    const beforeUnload = () => {
      try { sessionStorage.setItem('signout_reason', 'closed'); } catch {}
      // best-effort; may not complete before unload
      signOut(auth).catch(() => {});
    };
    window.addEventListener('beforeunload', beforeUnload);

    return () => {
      sub();
      if (timer.current) window.clearTimeout(timer.current);
      events.forEach(ev => window.removeEventListener(ev, reset));
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, []);
}
