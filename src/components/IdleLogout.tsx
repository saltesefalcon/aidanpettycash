'use client';

import { useEffect } from 'react';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useRouter } from 'next/navigation';

const IDLE_MS  = 45 * 60 * 1000; // 10 minutes
const CHECK_MS = 15 * 1000;      // poll every 15s

const KEY_LAST         = 'pc_last_activity';
const KEY_FORCE        = 'pc_force_sign_out';     // timestamp to signal other tabs to sign out
const KEY_REASON       = 'pc_sign_out_reason';    // 'idle' | 'closed'
const KEY_DOWNLOAD_TS  = 'pc_download_active_ts'; // timestamp set before opening a download
const KEY_REFRESHING   = 'pc_refreshing';         // set just before a reload/refresh

function isDownloadActive(): boolean {
  try {
    const ts = Number(localStorage.getItem(KEY_DOWNLOAD_TS) || 0);
    if (!ts) return false;
    const age = Date.now() - ts;
    if (age > 2 * 60 * 1000) { localStorage.removeItem(KEY_DOWNLOAD_TS); return false; }
    return age < 15 * 1000; // active for ~15s after click
  } catch {
    return false;
  }
}

function isRefreshing(): boolean {
  try { return sessionStorage.getItem(KEY_REFRESHING) === '1'; } catch { return false; }
}

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
      if (document.visibilityState !== 'hidden') {
        mark();
        // clear refresh sentinel shortly after we become visible again
        setTimeout(() => { try { sessionStorage.removeItem(KEY_REFRESHING); } catch {} }, 1500);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    // NEW: set a "refresh" sentinel right before unload
    const onBeforeUnload = () => {
      try { sessionStorage.setItem(KEY_REFRESHING, '1'); } catch {}
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    // Sign-out on tab close/navigation, but NEVER during downloads/login/scanner/refresh
    const onPageHide = () => {
      if (IS_SCANNER || IS_LOGIN) return;
      try {
        if (isDownloadActive()) return;
        if (isRefreshing()) return; // <-- allow page refresh without logging out
        localStorage.setItem(KEY_FORCE, String(Date.now()));
        localStorage.setItem(KEY_REASON, 'closed');
      } catch {}
      signOut(auth).catch(() => {});
      r.replace('/login?reason=closed');
    };
    window.addEventListener('pagehide', onPageHide);

    // Mirror sign-out requests from other tabs
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY_FORCE && e.newValue) {
        const reason = (localStorage.getItem(KEY_REASON) as 'idle' | 'closed') || 'idle';
        signOut(auth).catch(() => {}).finally(() => r.replace(`/login?reason=${reason}`));
      }
    };
    window.addEventListener('storage', onStorage);

    // Idle timer (skip while a download is in progress)
    const t = setInterval(async () => {
      try { if (isDownloadActive()) return; } catch {}
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
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
      clearInterval(t);
    };
  }, [r]);

  return null;
}
