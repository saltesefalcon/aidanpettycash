"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Active = "dashboard" | "entries" | "qbo" | "settings" | "admin";

export default function MobileNav({
  storeId = "",
  active,
}: {
  storeId?: string;
  active?: Active;
}) {
  const pathname = usePathname();

  // Map our tab keys to the actual route segment
  const routeOf: Record<Active, string> = {
    dashboard: "dashboard",
    entries: "entries",
    qbo: "qbo-export",
    settings: "settings",
    admin: "admin",
  };

  // Build hrefs: dashboard is global (/dashboard), all others are store-scoped
  const hrefFor = (key: Active) =>
    key === "dashboard" ? "/dashboard" : `/store/${storeId}/${routeOf[key]}`;

  // If "active" not provided, infer it from the path (fallback)
  const isActive = (key: Active) => {
    if (active) return active === key;
    if (key === "dashboard") return pathname === "/dashboard";
    return pathname.startsWith(`/store/${storeId}/${routeOf[key]}`);
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-white border-t border-gray-200">
      <div className="grid grid-cols-4 text-xs">
        <Link
          href={hrefFor("dashboard")}
          className={`py-3 text-center ${isActive("dashboard") ? "font-semibold" : ""}`}
        >
          Dashboard
        </Link>
        <Link
          href={hrefFor("entries")}
          className={`py-3 text-center ${isActive("entries") ? "font-semibold" : ""}`}
        >
          Entries
        </Link>
        <Link
          href={hrefFor("qbo")}
          className={`py-3 text-center ${isActive("qbo") ? "font-semibold" : ""}`}
        >
          QBO
        </Link>
        <Link
          href={hrefFor("settings")}
          className={`py-3 text-center ${isActive("settings") ? "font-semibold" : ""}`}
        >
          Settings
        </Link>
      </div>
    </nav>
  );
}
