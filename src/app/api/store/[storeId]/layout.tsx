"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function StoreLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { storeId: string };
}) {
  const pathname = usePathname();
  const storeId = params.storeId;

  const tabs = [
    { href: `/store/${storeId}/entries`, label: "Entries" },
    { href: `/store/${storeId}/admin`, label: "Admin" },
    { href: `/store/${storeId}/settings`, label: "Settings" },
  ];

  const isActive = (href: string) => pathname?.startsWith(href);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      {/* Top bar */}
      <header className="border-b bg-white/70 backdrop-blur supports-[backdrop-filter]:bg-white/60">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-xl bg-slate-900 text-white grid place-items-center font-semibold">
              PC
            </div>
            <div>
              <div className="text-sm font-medium text-slate-500">Petty Cash</div>
              <div className="text-base font-semibold">Store: <span className="text-slate-900">{storeId}</span></div>
            </div>
          </div>

          {/* Tabs */}
          <nav className="hidden md:flex items-center gap-2">
            {tabs.map((t) => (
              <Link
                key={t.href}
                href={t.href}
                className={[
                  "px-3 py-2 rounded-lg text-sm font-medium transition",
                  isActive(t.href)
                    ? "bg-slate-900 text-white shadow-sm"
                    : "text-slate-700 hover:bg-slate-100",
                ].join(" ")}
              >
                {t.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      {/* Page container */}
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
