'use client';

import { useEffect } from 'react';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useRouter } from 'next/navigation';

const IDLE_MS  = 10 * 60 * 1000; // 10 minutes
const CHECK_MS = 15 * 1000;      // poll every 15s

const KEY_LAST   = 'pc_last_activity';
const KEY_FORCE  = 'pc_force_sign_out';  // timestamp to signal other tabs to sign out
const KEY_REASON = 'pc_sign_out_reason'; // 'idle' | 'closed'

export default function IdleLogout() {
  const r = useRouter();

  useEffect(() => {
    const path = typeof window !== 'undefined' ? window.location.pathname : '';
    const IS_SCANNER = /^\/scanner/i.test(path);
    const IS_LOGIN   = /^\/login/i.test(path);

    // record activity
    const mark = () => {
      try { localStorage.setItem(KEY_LAST, String(Date.now())); } catch {}
    };
    mark();

    const onAny = () => {
      if (document.visibilityState === 'hidden') return;
      mark();
    };

    const winEvents: Array<keyof WindowEventMap> = [
      'mousedown','mousemove','keydown','touchstart','touchmove','wheel','scroll','focus'
    ];
    winEvents.forEach(ev => window.addEventListener(ev, onAny, { passive: true }));

    const onVisibility = () => {
      if (document.visibilityState !== 'hidden') mark();
    };
    document.addEventListener('visibilitychange', onVisibility);

    // Only main app tabs should sign out on close; NEVER the scanner popup.
    let onPageHide: (() => void) | null = null;
    if (!IS_SCANNER && !IS_LOGIN) {
      onPageHide = () => {
        try {
          localStorage.setItem(KEY_FORCE, String(Date.now()));
          localStorage.setItem(KEY_REASON, 'closed');
        } catch {}
        signOut(auth).catch(() => {});
        r.replace('/login?reason=closed');
      };
      window.addEventListener('pagehide', onPageHide);
      window.addEventListener('beforeunload', onPageHide);
    }

    // Mirror sign-out requests from other tabs
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY_FORCE && e.newValue) {
        const reason = (localStorage.getItem(KEY_REASON) as 'idle' | 'closed') || 'idle';
        signOut(auth).catch(() => {}).finally(() => r.replace(`/login?reason=${reason}`));
      }
    };
    window.addEventListener('storage', onStorage);

    // Idle timer
    const t = setInterval(async () => {
      const last = Number(localStorage.getItem(KEY_LAST) || 0);
      const idle = Date.now() - last;
      if (idle > IDLE_MS) {
        try {
          localStorage.setItem(KEY_FORCE, String(Date.now()));
          localStorage.setItem(KEY_REASON, 'idle');
        } catch {}
        await signOut(auth).catch(() => {});
        r.replace('/login?reason=idle');
      }
    }, CHECK_MS);

    return () => {
      winEvents.forEach(ev => window.removeEventListener(ev, onAny));
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('storage', onStorage);
      if (onPageHide) {
        window.removeEventListener('pagehide', onPageHide);
        window.removeEventListener('beforeunload', onPageHide);
      }
      clearInterval(t);
    };
  }, [r]);

  return null;
}

