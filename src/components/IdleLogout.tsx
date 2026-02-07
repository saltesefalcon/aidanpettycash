'use client';

import { useEffect, useRef } from 'react';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { usePathname, useRouter } from 'next/navigation';

const IDLE_MS = 45 * 60 * 1000; // 45 minutes
const CHECK_MS = 15 * 1000; // poll every 15s

const KEY_LAST = 'pc_last_activity';
const KEY_FORCE = 'pc_force_sign_out'; // timestamp to signal other tabs to sign out
const KEY_REASON = 'pc_sign_out_reason'; // 'idle' | 'closed' (we mostly use 'idle')
const KEY_DOWNLOAD_TS = 'pc_download_active_ts'; // timestamp set before opening a download
const KEY_REFRESHING = 'pc_refreshing'; // set just before a reload/refresh

function isDownloadActive(): boolean {
  try {
    const ts = Number(localStorage.getItem(KEY_DOWNLOAD_TS) || 0);
    if (!ts) return false;
    const age = Date.now() - ts;

    // more than 2 minutes old → throw it away
    if (age > 2 * 60 * 1000) {
      localStorage.removeItem(KEY_DOWNLOAD_TS);
      return false;
    }

    // treat as “active” for ~15s after click
    return age < 15 * 1000;
  } catch {
    return false;
  }
}

function isRefreshing(): boolean {
  try {
    return sessionStorage.getItem(KEY_REFRESHING) === '1';
  } catch {
    return false;
  }
}

function isScannerPath(pathname: string): boolean {
  return pathname.startsWith('/scanner-demo') || pathname.startsWith('/scanner');
}

export default function IdleLogout() {
  const r = useRouter();
  const pathnameRaw = usePathname();
  const pathname = pathnameRaw || '';

  const pathRef = useRef(pathname);
  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const w = window;

    // --- activity tracking ---
    const mark = () => {
      try {
        localStorage.setItem(KEY_LAST, String(Date.now()));
      } catch {}
    };

    // mark immediately on mount
    mark();

    // IMPORTANT: do NOT bail out just because the document is "hidden"
    // (camera / file dialogs / overlays can cause weird visibility behavior).
    const onAny = () => mark();

    const winEvents: Array<keyof WindowEventMap> = [
      'mousedown',
      'mousemove',
      'pointerdown',
      'pointermove',
      'keydown',
      'touchstart',
      'touchmove',
      'wheel',
      'scroll',
      'focus',
    ];

    winEvents.forEach((ev) => w.addEventListener(ev, onAny, { passive: true }));

    const onVisibility = () => {
      if (document.visibilityState !== 'hidden') {
        mark();
        setTimeout(() => {
          try {
            sessionStorage.removeItem(KEY_REFRESHING);
          } catch {}
        }, 1500);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    // mark that we're refreshing/closing *before* unload (NO signOut here)
    const onBeforeUnload = () => {
      try {
        sessionStorage.setItem(KEY_REFRESHING, '1');
      } catch {}
    };
    w.addEventListener('beforeunload', onBeforeUnload);

    // --- cross-tab sign-out mirroring (used when idle timer fires) ---
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY_FORCE && e.newValue) {
        const reason = (localStorage.getItem(KEY_REASON) as 'idle' | 'closed') || 'idle';
        signOut(auth)
          .catch(() => {})
          .finally(() => r.replace(`/login?reason=${reason}`));
      }
    };
    w.addEventListener('storage', onStorage);

    // --- idle timer ---
    const t = setInterval(async () => {
      // If you’re on scanner routes, continuously “keep alive” activity.
      // This prevents accidental idle signouts while scanning/attaching.
      if (isScannerPath(pathRef.current)) {
        mark();
        return;
      }

      // If you’re already signed out, don’t do anything here.
      // Let SessionGuard/Auth handle redirects.
      if (!auth.currentUser) return;

      try {
        if (isDownloadActive()) return;
        if (isRefreshing()) return;
      } catch {}

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
      winEvents.forEach((ev) => w.removeEventListener(ev, onAny));
      document.removeEventListener('visibilitychange', onVisibility);
      w.removeEventListener('storage', onStorage);
      w.removeEventListener('beforeunload', onBeforeUnload);
      clearInterval(t);
    };
  }, [r]);

  return null;
}
