"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

export default function StoreLandingPage() {
  const { storeId } = useParams<{ storeId: string }>();

  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold tracking-tight mb-6">{storeId} · Petty Cash</h1>

      <div className="grid gap-6 md:grid-cols-2">
        <Link
          href={`/store/${storeId}/entries`}
          className="rounded-xl border p-6 hover:bg-gray-50 transition"
        >
          <div className="text-lg font-medium">Enter petty cash</div>
          <div className="text-sm text-gray-600 mt-1">
            Add purchases with HST, auto-calc net. See recent activity.
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
