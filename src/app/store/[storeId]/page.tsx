'use client';

import { useParams } from 'next/navigation';

export default function StoreHome() {
  const { storeId } = useParams<{storeId: string}>();
  return (
    <div className="min-h-screen p-6">
      <h1 className="text-2xl font-semibold mb-2">Store: {storeId}</h1>
      <p className="opacity-80">You are authenticated and inside this store’s workspace.</p>
    </div>
  );
}
