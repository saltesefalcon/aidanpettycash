'use client';
import { useParams } from 'next/navigation';
import Link from 'next/link';

export default function StoreHome() {
  const { storeId } = useParams<{storeId: string}>();
  return (
    <div className="min-h-screen p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Store: {String(storeId)}</h1>
        <Link href={`/store/${storeId}/settings`}
          className="rounded-xl px-4 py-2 bg-brand-accent/90 hover:bg-brand-accent text-black font-medium">
          Settings
        </Link>
      </div>
      <p className="opacity-80">You are authenticated and inside this store’s workspace.</p>
    </div>
  );
}

