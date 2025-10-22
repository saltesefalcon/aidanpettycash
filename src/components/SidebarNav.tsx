'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, useMemo } from 'react';

/**
 * Locks the current store across navigation:
 * - If you're on /store/[storeId]/..., we use that [storeId].
 * - If you're on a non-store route (e.g., /dashboard), we fall back
 *   to the last selected store saved in localStorage ("pc.selectedStore").
 * - We update localStorage whenever we detect a storeId in the URL.
 */
function useLockedStoreId() {
  const pathname = usePathname();
  const [storeId, setStoreId] = useState<string>('');

  useEffect(() => {
    // Try to read storeId from the current URL
    const m = pathname?.match(/\/store\/([^/]+)/);
    const fromUrl = m?.[1];

    if (fromUrl) {
      setStoreId(fromUrl);
      try {
        localStorage.setItem('pc.selectedStore', fromUrl);
      } catch {
        /* ignore */
      }
    } else {
      // No store in URL (e.g., /dashboard) — use last selected store if any
      try {
        const saved = localStorage.getItem('pc.selectedStore') || '';
        if (saved) setStoreId(saved);
      } catch {
        /* ignore */
      }
    }
  }, [pathname]);

  return storeId;
}

export default function SidebarNav() {
  const storeId = useLockedStoreId();

  // Build links. Store-scoped links are disabled until a storeId is known.
  const items = useMemo(
    () => [
      { href: '/dashboard', label: 'Dashboard', needsStore: false },
      { href: storeId ? `/store/${storeId}/entries` : '#', label: 'Entries', needsStore: true },
      { href: storeId ? `/store/${storeId}/admin`   : '#', label: 'Admin',   needsStore: true },
      { href: storeId ? `/store/${storeId}/qbo-export` : '#', label: 'QBO Export', needsStore: true },
      { href: 'settings', label: 'Settings', needsStore: false },
    ],
    [storeId]
  );

  return (
    <nav className="p-4 space-y-2">
      {items.map((i) => (
        <Link
          key={i.label}
          href={i.href}
          className={[
            'block hover:underline',
            i.needsStore && !storeId ? 'pointer-events-none opacity-50' : '',
          ].join(' ')}
          aria-disabled={i.needsStore && !storeId ? 'true' : 'false'}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
