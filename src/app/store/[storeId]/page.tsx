"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { db } from "../../../lib/firebase";
import { doc, getDoc } from "firebase/firestore";

export default function StoreLandingPage() {
  const { storeId } = useParams<{ storeId: string }>();
  const [displayName, setDisplayName] = useState<string | null>(null);

  // Optional: read pretty name from /stores/<id>. Falls back to the id slug.
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, "stores", String(storeId)));
        if (snap.exists()) setDisplayName((snap.data() as any).name || null);
      } catch {
        // non-fatal: just show the slug
      }
    })();
  }, [storeId]);

  const label = displayName || String(storeId);

  return (
    <main className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{label} · Petty Cash</h1>
        <Link
          href={`/store/${storeId}/settings`}
          className="rounded-xl px-4 py-2 bg-brand-accent/90 hover:bg-brand-accent text-black font-medium"
        >
          Settings
        </Link>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Link
          href={`/store/${storeId}/entries`}
          className="rounded-xl border p-6 hover:bg-gray-50 transition"
        >
          <div className="text-lg font-medium">Enter petty cash</div>
          <div className="text-sm text-gray-600 mt-1">
            Add purchases with HST; net auto-calculated; see recent activity.
          </div>
        </Link>

        <Link
          href={`/admin?store=${storeId}`}
          className="rounded-xl border p-6 hover:bg-gray-50 transition"
        >
          <div className="text-lg font-medium">Admin</div>
          <div className="text-sm text-gray-600 mt-1">
            Cash-ins, deposits, opening balance, audits, and user management.
          </div>
        </Link>
      </div>
    </main>
  );
}

