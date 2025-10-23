// src/app/dashboard/layout.tsx
import { Suspense } from "react";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // This satisfies Next 15's requirement for useSearchParams/usePathname/useRouter
  return <Suspense fallback={null}>{children}</Suspense>;
}
