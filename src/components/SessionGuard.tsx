'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';

/**
 * SessionGuard
 * - Renders immediately on /login (no blocking).
 * - For all other routes, waits for auth (once).
 * - If role === "manager":
 *     • Allow /store/[storeId]/entries for assigned stores
 *     • Also allow global scanner routes: /scanner-demo and /scanner
 *     • Otherwise redirect to their first allowed store's Entries
 *
 * Changes in this version:
 * - onAuthStateChanged subscription is created ONCE (not re-created on every route change)
 * - Manager ACL enforcement runs on route changes using cached membership data
 * - Adds a small grace period before redirecting to /login when user becomes null
 */
export default function SessionGuard({ children }: { children: React.ReactNode }) {
  const pathnameRaw = usePathname();
  const pathname = pathnameRaw || '';
  const router = useRouter();

  const onLogin = pathname.startsWith('/login');

  const isScanner = useMemo(() => {
    return pathname.startsWith('/scanner-demo') || pathname.startsWith('/scanner');
  }, [pathname]);

  // Render /login immediately; otherwise block until first auth check completes
  const [ready, setReady] = useState<boolean>(onLogin);

  const [role, setRole] = useState<'admin' | 'manager' | ''>('');
  const [allowedStores, setAllowedStores] = useState<string[]>([]);
  const [membershipLoaded, setMembershipLoaded] = useState<boolean>(false);

  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRedirectTimer = () => {
    if (redirectTimerRef.current) {
      clearTimeout(redirectTimerRef.current);
      redirectTimerRef.current = null;
    }
  };

  // 1) Subscribe to auth changes ONCE
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      clearRedirectTimer();

      // /login: if already signed-in, bounce to dashboard; otherwise render immediately
      if (pathname.startsWith('/login')) {
        if (user) router.replace('/dashboard');
        setReady(true);
        return;
      }

      // Everywhere else requires auth
      if (!user) {
        // Grace period prevents transient auth blips from instantly nuking the page
        redirectTimerRef.current = setTimeout(() => {
          if (!auth.currentUser) {
            router.replace('/login?reason=auth');
          }
        }, 1500);

        setReady(true);
        return;
      }

      // User is signed in — load membership once per auth session
      try {
        const snap = await getDoc(doc(db, 'memberships', user.uid));
        const data = snap.data() || {};

        const r = (data.role as 'admin' | 'manager' | '') || '';
        const stores = Array.isArray(data.storeIds) ? (data.storeIds as string[]) : [];

        setRole(r);
        setAllowedStores(stores);
      } catch (e) {
        // If membership read fails for any reason, don't hard-redirect here.
        // Firestore rules still protect data; UI routing is just a convenience.
        setRole('');
        setAllowedStores([]);
        // eslint-disable-next-line no-console
        console.error('SessionGuard: failed to read memberships/{uid}', e);
      } finally {
        setMembershipLoaded(true);
        setReady(true);
      }
    });

    return () => {
      clearRedirectTimer();
      unsub();
    };
    // router is stable; do NOT include pathname here (we don't want re-subscribe per route change)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  // 2) Enforce manager ACL on route changes (using cached membership)
  useEffect(() => {
    // /login should never be blocked
    if (onLogin) return;

    // Don’t enforce until we’ve checked auth at least once
    if (!ready) return;

    const user = auth.currentUser;
    if (!user) return; // redirect handled by auth listener

    // Only enforce after membership is loaded (otherwise we can bounce incorrectly)
    if (!membershipLoaded) return;

    if (role !== 'manager') return;

    // Managers: allow scanner routes always
    if (isScanner) return;

    // Match /store/[storeId]/[section?]
    const match = pathname.match(/^\/store\/([^/]+)(?:\/([^/?#]+))?/);
    const storeOnUrl = match?.[1] ?? '';
    const section = match?.[2] ?? '';

    // Only "entries" section allowed for managers
    const sectionAllowed = section === 'entries';

    // Must be one of their allowed stores
    const storeAllowed = !!storeOnUrl && allowedStores.includes(storeOnUrl);

    const targetStore = storeAllowed ? storeOnUrl : (allowedStores[0] || '');

    if (!sectionAllowed || !storeAllowed) {
      if (targetStore) {
        const target = `/store/${targetStore}/entries`;
        if (pathname !== target) router.replace(target);
      } else {
        router.replace('/login?reason=not-authorized');
      }
    }
  }, [allowedStores, isScanner, membershipLoaded, onLogin, pathname, ready, role, router]);

  if (!ready) return null;
  return <>{children}</>;
}
