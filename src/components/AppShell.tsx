'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import IdleLogout from '@/components/IdleLogout';
import SidebarNav from '@/components/SidebarNav'; // used for admins
import TopBar from '@/components/TopBar';
import { StoreProvider } from '@/context/StoreContext';

import { auth, db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';

type Role = 'admin' | 'manager' | '';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '';
  const isLogin = pathname.startsWith('/login');
  const isDashboard = pathname === '/dashboard';
  const inStore = /^\/store\/[^/]+/.test(pathname);

  // Treat scanner pages specially
  const isScanner = pathname.startsWith('/scanner-demo') || pathname.startsWith('/scanner');

  // ---- Membership (role + allowed stores) ----
  const [role, setRole] = useState<Role>('');
  const [allowedStores, setAllowedStores] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Do not touch Firestore on /login or scanner routes
    if (isLogin || isScanner) {
      setLoaded(true);
      return;
    }

    const u = auth.currentUser;
    if (!u) {
      // SessionGuard will redirect; nothing to fetch here.
      setLoaded(true);
      return;
    }

    getDoc(doc(db, 'memberships', u.uid))
      .then((s) => {
        const data = s.data() || {};
        setRole((data.role as Role) || '');
        setAllowedStores(Array.isArray(data.storeIds) ? data.storeIds : []);
      })
      .finally(() => setLoaded(true));
  }, [isLogin, isScanner]);

  // infer current storeId from the URL ( …/store/[storeId]/… )
  const storeIdFromPath = useMemo(() => {
    const m = pathname.match(/\/store\/([^/]+)/);
    return (m && m[1]) || '';
  }, [pathname]);

  // choose a storeId for links (URL store if present, else first allowed)
  const effectiveStoreId = storeIdFromPath || allowedStores[0] || '';

  // ---- Minimal manager nav (Entries only) ----
  const ManagerSidebar = () => (
    <nav className="space-y-2">
      <Link
        href={effectiveStoreId ? `/store/${effectiveStoreId}/entries` : '#'}
        className="block hover:underline"
      >
        Entries
      </Link>
    </nav>
  );

  // ---- Early return for login page (no shell/providers) ----
  if (isLogin) {
    return <main className="min-h-screen min-w-0 overflow-x-hidden">{children}</main>;
  }

  // Optional tiny shimmer while membership loads (keeps layout stable)
  const SidebarSkeleton = () => (
    <div className="p-4 space-y-2 animate-pulse">
      <div className="h-4 w-24 bg-gray-200 rounded" />
      <div className="h-4 w-20 bg-gray-200 rounded" />
      <div className="h-4 w-28 bg-gray-200 rounded" />
    </div>
  );

  // Hide the sidebar on dashboard and scanner pages
  const showSidebar = !isLogin && !isDashboard && !isScanner;

  const Shell = (
    <div
      className={`min-h-screen w-screen overflow-x-hidden grid grid-cols-1 ${
        showSidebar ? 'md:grid-cols-[220px_minmax(0,1fr)]' : ''
      }`}
    >
      {showSidebar && (
        <aside className="hidden md:block w-[220px] shrink-0 border-r bg-white/70 backdrop-blur supports-[backdrop-filter]:bg-white/60">
          <div className="p-4 text-base font-semibold tracking-wide">Petty Cash</div>

          {!loaded ? (
            <SidebarSkeleton />
          ) : role === 'manager' ? (
            <div className="px-4">
              <ManagerSidebar />
            </div>
          ) : (
            // Admins keep your full SidebarNav (Dashboard/Admin/QBO/Settings)
            <SidebarNav />
          )}
        </aside>
      )}

      <div className="flex flex-col min-h-screen">
        {/* Wrap so header can shrink/wrap instead of widening the page */}
        {!isScanner && (
          <div className="px-4 md:px-8 min-w-0">
            <TopBar />
          </div>
        )}

        {/* Main content: allow children to shrink within grid cell */}
        <main className="p-4 md:p-8 flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );

  // Only mount StoreProvider on store-scoped routes to avoid listeners without a storeId
  return inStore ? (
    <StoreProvider>
      <IdleLogout />
      {Shell}
    </StoreProvider>
  ) : (
    <>
      <IdleLogout />
      {Shell}
    </>
  );
}
