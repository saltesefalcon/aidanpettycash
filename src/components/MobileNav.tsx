"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

type Props = {
  storeId: string;        // always pass from the page component
};

export default function MobileNav({ storeId }: Props) {
  const sp = useSearchParams();
  const m = sp.get("m") || new Date().toISOString().slice(0, 7); // YYYY-MM

  // IMPORTANT: Dashboard is global
  const items = [
    { label: "Dashboard", href: `/dashboard` },                             // <— global
    { label: "Entries",   href: `/store/${storeId}/entries?m=${m}` },
    { label: "Cash In",   href: `/store/${storeId}/cashins?m=${m}` },
    { label: "QBO Export",href: `/store/${storeId}/qbo-export?m=${m}` },
    { label: "Settings",  href: `/store/${storeId}/settings` },
  ];

  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 bg-white border-t shadow md:hidden">
      <ul className="grid grid-cols-5 text-xs">
        {items.map((it) => (
          <li key={it.label}>
            <Link
              href={it.href}
              className="flex flex-col items-center justify-center h-14 px-2 hover:bg-slate-50"
            >
              <span className="font-medium">{it.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
