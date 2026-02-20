'use client';

import React from 'react';
import { auth, db } from '@/lib/firebase';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { signOut } from 'firebase/auth';

// Title-case helper for store display names
function toTitle(s: string = ''): string {
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

type StoreItem = { id: string; name: string };

function swapStoreInPath(path: string, newId: string): string {
  const parts = path.split('/').filter(Boolean);
  const i = parts.findIndex((p) => p === 'store' || p === 'stores');
  if (i >= 0 && parts[i + 1]) {
    parts[i + 1] = newId;
    return '/' + parts.join('/');
  }
  // fallback target if current path has no store segment
  return `/stores/${newId}/entries`;
}

export default function TopBar() {
  const r = useRouter();
  const pathname = usePathname() || '';
  const search = useSearchParams();

  // Hide the store selector on the dashboard
  const onDashboard = pathname.startsWith('/dashboard');
  const onTransfers = /\/transfers(\/|$)/.test(pathname);
  const topTitle = onTransfers ? "Company Transfers" : "Petty Cash";
  const [stores, setStores] = React.useState<StoreItem[]>([]);
  const [currentStoreId, setCurrentStoreId] = React.useState<string | null>(null);
  const [role, setRole] = React.useState<'admin' | 'manager' | null>(null);

  // detect current store from URL once
  React.useEffect(() => {
    const parts = pathname.split('/').filter(Boolean);
    const i = parts.findIndex((p) => p === 'store' || p === 'stores');
    setCurrentStoreId(i >= 0 ? parts[i + 1] : null);
  }, [pathname]);

  // load allowed stores for current user
  React.useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    (async () => {
      const m = await getDoc(doc(db, 'memberships', uid));
      const role = (m.data()?.role as string) || 'manager';
      setRole(role as any);

      if (role === 'admin') {
        const snap = await getDocs(collection(db, 'stores'));
        const all = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as any[];
        setStores(
          all
            .map((s) => ({ id: s.id, name: toTitle(s.name || s.id) }))
            .sort((a, b) => a.name.localeCompare(b.name))
        );
      } else {
        const ids: string[] = (m.data()?.storeIds as string[]) || [];
        const snap = await getDocs(collection(db, 'stores'));
        const nameMap = new Map(
          snap.docs.map((d) => [d.id, toTitle((d.data() as any).name || d.id)])
        );
        const list = ids.map((id) => ({ id, name: nameMap.get(id) || toTitle(id) }));
        setStores(list.sort((a, b) => a.name.localeCompare(b.name)));
      }
    })();
  }, []);

  const currentStoreName = React.useMemo(() => {
    if (!currentStoreId) return '';
    const found = stores.find((s) => s.id === currentStoreId);
    return found ? found.name : toTitle(currentStoreId);
  }, [stores, currentStoreId]);

  function onSwitch(storeId: string) {
    const dest = swapStoreInPath(pathname, storeId);
    const qs = search?.toString();
    r.replace(qs ? `${dest}?${qs}` : dest);
  }

  return (
    <div className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b">
      <div className="px-4 h-12 flex items-center justify-between gap-3">
        <div className="font-semibold">{topTitle}</div>

        {/* Admin can switch; managers just see their current store.
            The selector is hidden on the dashboard to avoid pre-store errors. */}
        <div className="flex items-center gap-3">
          {!onDashboard && stores.length > 0 && role === 'admin' ? (
            <select
              value={currentStoreId || ''}
              onChange={(e) => onSwitch(e.target.value)}
              className="border rounded px-2 py-1 bg-white"
              title="Switch store"
            >
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          ) : currentStoreId ? (
            <div className="text-sm opacity-80">{currentStoreName}</div>
          ) : null}

          <div className="text-xs opacity-70 hidden sm:block">
            {auth.currentUser?.email}
          </div>
          <button
            className="text-sm underline"
            onClick={async () => {
              await signOut(auth);
              r.replace('/login');
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
