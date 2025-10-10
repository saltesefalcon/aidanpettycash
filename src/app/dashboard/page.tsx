'use client';

import { useEffect, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth, db } from '../../lib/firebase'; // relative import to avoid alias issues
import { doc, getDoc } from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function Dashboard() {
  const r = useRouter();
  const [stores, setStores] = useState<string[] | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) return r.replace('/login');
      const m = await getDoc(doc(db, 'memberships', u.uid));
      const list = (m.exists() ? (m.data().storeIds as string[]) : []) ?? [];
      setStores(list);
    });
    return () => unsub();
  }, [r]);

  async function doSignOut() {
    await signOut(auth);
    r.replace('/login');
  }

  return (
    <div className="min-h-screen p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Choose a store</h1>
        <button onClick={doSignOut} className="rounded-xl px-3 py-2 bg-white/10 hover:bg-white/20">
          Sign out
        </button>
      </div>

      {!stores && <div>Loading…</div>}
      {stores && stores.length === 0 && <div>No stores assigned to your account.</div>}

      {stores && stores.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {stores.map((id) => (
            <Link key={id} href={`/store/${id}`}
              className="block rounded-2xl bg-brand-card p-5 hover:ring-2 hover:ring-brand-accent transition">
              <div className="text-lg font-medium capitalize">{id}</div>
              <div className="text-sm opacity-70">Open petty cash log</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
