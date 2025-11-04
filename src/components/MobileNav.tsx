// src/components/MobileNav.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function MobileNav({ storeId }: { storeId: string }) {
  const pathname = usePathname();

  const entriesHref  = `/store/${storeId}`;
  const qboHref      = `/store/${storeId}/qbo-export`;
  const settingsHref = `/store/${storeId}/settings`;
  const dashHref     = `/dashboard`; // global dashboard (shared across stores)

  const isEntries  = pathname === entriesHref || pathname.startsWith(`/store/${storeId}/entries`);
  const isQbo      = pathname.startsWith(qboHref);
  const isSettings = pathname.startsWith(settingsHref);
  const isDash     = pathname === "/dashboard";

  const Item = ({ href, label, active }: { href: string; label: string; active: boolean }) => (
    <Link
      href={href}
      className={`flex-1 py-2 text-center text-xs ${active ? "font-semibold" : "opacity-70"} hover:opacity-100`}
    >
      {label}
    </Link>
  );

  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 border-t bg-white/95 backdrop-blur">
      <div className="flex items-stretch">
        <Item href={entriesHref}  label="Entries"   active={isEntries} />
        <Item href={qboHref}      label="QBO Export" active={isQbo} />
        <Item href={settingsHref} label="Settings"  active={isSettings} />
        <Item href={dashHref}     label="Dashboard" active={isDash} />
      </div>
    </nav>
  );
}
