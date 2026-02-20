// src/components/MobileNav.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

type NavKey = "entries" | "transfers" | "admin" | "qbo" | "settings" | "dashboard";

export default function MobileNav({
  storeId,
  active,
}: {
  storeId: string;
  active?: NavKey;
}) {
  const pathname = usePathname();

  // Derive active tab if prop not supplied
  const derived: NavKey | undefined =
    active ??
    (pathname?.startsWith(`/store/${storeId}/transfers`)
      ? "transfers"
      : pathname?.startsWith(`/store/${storeId}/admin`)
      ? "admin"
      : pathname?.startsWith(`/store/${storeId}/qbo-export`)
      ? "qbo"
      : pathname?.startsWith(`/store/${storeId}/settings`)
      ? "settings"
      : pathname === "/dashboard"
      ? "dashboard"
      : pathname?.startsWith(`/store/${storeId}`)
      ? "entries"
      : undefined);

  const Item = ({
    k,
    href,
    label,
  }: {
    k: NavKey;
    href: string;
    label: string;
  }) => (
    <Link
      href={href}
      aria-current={derived === k ? "page" : undefined}
      className={clsx(
        "flex items-center justify-center py-3 text-sm",
        derived === k ? "font-semibold text-white" : "font-medium text-white/80"
      )}
    >
      {label}
    </Link>
  );

  return (
    <nav
      className="
        md:hidden fixed inset-x-0 bottom-0 z-50
        border-t border-white/15
        bg-black/80 backdrop-blur supports-[backdrop-filter]:bg-black/60
        pb-[env(safe-area-inset-bottom)]
      "
    >
      <div className="max-w-3xl mx-auto grid grid-cols-6">
        <Item k="entries"    href={`/store/${storeId}`}              label="Entries" />
        <Item k="transfers"  href={`/store/${storeId}/transfers`}    label="Transfers" />
        <Item k="admin"      href={`/store/${storeId}/admin`}        label="Admin" />
        <Item k="qbo"        href={`/store/${storeId}/qbo-export`}   label="QBO" />
        <Item k="settings"   href={`/store/${storeId}/settings`}     label="Settings" />
        <Item k="dashboard"  href={`/dashboard`}                    label="Dashboard" />
      </div>
    </nav>
  );
}
