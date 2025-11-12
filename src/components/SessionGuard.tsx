'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';

/**
 * SessionGuard
 * - Renders immediately on /login (no blocking).
 * - For all other routes, waits for auth.
 * - If role === "manager":
 *     • Allow /store/[storeId]/entries for assigned stores
 *     • Also allow global scanner routes: /scanner-demo and /scanner
 *     • Otherwise redirect to their first allowed store's Entries
 */
export default function SessionGuard({ children }: { children: React.ReactNode }) {
  const pathnameRaw = usePathname();
  const pathname = pathnameRaw || '';
  const router = useRouter();

  const onLogin = pathname.startsWith('/login');
  // ✅ mark scanner routes as always allowed for managers
  const isScanner =
    pathname.startsWith('/scanner-demo') ||
    pathname.startsWith('/scanner');

  const [ready, setReady] = useState(onLogin); // /login renders immediately
  const [role, setRole] = useState<'admin' | 'manager' | ''>('');
  const [allowedStores, setAllowedStores] = useState<string[]>([]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      // /login: if already signed-in, bounce to dashboard; otherwise render immediately
      if (onLogin) {
        if (user) router.replace('/dashboard');
        setReady(true);
        return;
      }

      // Everywhere else requires auth
      if (!user) {
        router.replace('/login?reason=auth');
        setReady(true);
        return;
      }

      try {
        // Fetch membership (role + storeIds)
        const snap = await getDoc(doc(db, 'memberships', user.uid));
        const data = snap.data() || {};
        const r = (data.role as 'admin' | 'manager' | '') || '';
        const stores = Array.isArray(data.storeIds) ? (data.storeIds as string[]) : [];

        setRole(r);
        setAllowedStores(stores);

        // Managers: enforce section + store ACL
        if (r === 'manager') {
          // ✅ allow scanner routes without redirect
          if (isScanner) {
            return; // stay on /scanner-demo or /scanner
          }

          // Match /store/[storeId]/[section?]
          const match = pathname.match(/^\/store\/([^/]+)(?:\/([^/?#]+))?/);
          const storeOnUrl = match?.[1] ?? '';
          const section = match?.[2] ?? '';

          // Only "entries" section allowed
          const sectionAllowed = section === 'entries';

          // Must be one of their allowed stores
          const storeAllowed = !!storeOnUrl && stores.includes(storeOnUrl);

          // Choose a safe destination
          const targetStore = storeAllowed ? storeOnUrl : (stores[0] || '');

          // If the current path is not allowed, redirect to safe Entries route
          if (!sectionAllowed || !storeAllowed) {
            if (targetStore) {
              const target = `/store/${targetStore}/entries`;
              if (pathname !== target) router.replace(target);
            } else {
              // No assigned stores -> sign out or send to login with reason
              router.replace('/login?reason=not-authorized');
            }
          }
        }
      } finally {
        setReady(true);
      }
    });

    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onLogin, isScanner, pathname]);

  if (!ready) return null; // could render a tiny skeleton here
  return <>{children}</>;
}
