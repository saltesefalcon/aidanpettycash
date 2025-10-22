'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminIndex() {
  const r = useRouter();
  useEffect(() => {
    // You can send this anywhere; dashboard is a safe home
    r.replace('/dashboard');
  }, [r]);
  return null;
}
