'use client';

import { useEffect } from 'react';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useRouter } from 'next/navigation';

const IDLE_MS = 10 * 60 * 1000;   // 10 minutes
const CHECK_MS = 15 * 1000;       // poll every 15s
const KEY_LAST = 'pc_last_activity';
const KEY_FORCE = 'pc_force_sign_out';

export default function IdleLogout() {
  const r = useRouter();

  useEffect(() => {
    // mark activity in localStorage (shared by tabs from same origin)
    const mark = () => {
      try { localStorage.setItem(KEY_LAST, String(Date.now())); } catch {}
    };
    mark();

    const onAny = () => {
      if (document.visibilityState === 'hidden') return;
      mark();
    };

    const events: Array<keyof WindowEventMap> = [
      'mousedown','mousemove','keydown','touchstart','scroll','focus','visibilitychange'
    ];
    events.forEach(ev => window.addEventListener(ev, onAny, { passive: true }));

    // If another tab signs out, mirror it here
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY_FORCE && e.newValue) {
        signOut(auth).catch(() => {}).finally(() => r.replace('/login?reason=idle'));
      }
    };
    window.addEventListener('storage', onStorage);

    // periodic idle check
    const t = setInterval(async () => {
      const last = Number(localStorage.getItem(KEY_LAST) || 0);
      const idle = Date.now() - last;
      if (idle > IDLE_MS) {
        try { localStorage.setItem(KEY_FORCE, String(Date.now())); } catch {}
        await signOut(auth).catch(() => {});
        r.replace('/login?reason=idle');
      }
    }, CHECK_MS);

    return () => {
      events.forEach(ev => window.removeEventListener(ev, onAny));
      window.removeEventListener('storage', onStorage);
      clearInterval(t);
    };
  }, [r]);

  return null;
}
