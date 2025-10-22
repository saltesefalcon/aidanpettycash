// src/context/StoreContext.tsx
'use client';

import React from 'react';
import { useRouter, usePathname } from 'next/navigation';

type Ctx = {
  storeId: string;
  setStoreId: (id: string, opts?: { stayOnPage?: boolean }) => void;
};

const StoreContext = React.createContext<Ctx | null>(null);
const COOKIE = 'pc.store';
const FALLBACK = 'cesoir';

function readCookie(name: string) {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1') + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}
function writeCookie(name: string, value: string) {
  const expires = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toUTCString(); // ~6 months
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [storeId, setStoreIdState] = React.useState<string>(FALLBACK);

  // hydrate from cookie once on mount
  React.useEffect(() => {
    const c = readCookie(COOKIE);
    if (c) setStoreIdState(c);
    else writeCookie(COOKIE, FALLBACK);
  }, []);

  const setStoreId = React.useCallback(
    (id: string, opts?: { stayOnPage?: boolean }) => {
      setStoreIdState(id);
      writeCookie(COOKIE, id);

      // optional: keep user on same page, just swap the /store/{id}/ segment
      if (opts?.stayOnPage && pathname) {
        // If path already contains /store/{old}/ replace it; otherwise send to entries
        const replaced = pathname.replace(/^(\/store\/)[^/]+/, `$1${id}`);
        if (replaced !== pathname) router.replace(replaced);
        else router.replace(`/store/${id}/entries`);
      }
    },
    [pathname, router]
  );

  return (
    <StoreContext.Provider value={{ storeId, setStoreId }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  const ctx = React.useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>');
  return ctx;
}
