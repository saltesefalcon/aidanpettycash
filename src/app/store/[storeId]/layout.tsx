import Link from 'next/link';
import { Suspense } from 'react';
import StoreSwitch from '@/components/StoreSwitch'; // make sure this exists

export default function StoreLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { storeId: string };     // <-- not a Promise
}) {
  const { storeId } = params;

  const NavLink = ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <Link href={href} className="text-sm hover:underline">
      {children}
    </Link>
  );

  return (
    <Suspense fallback={null}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="text-sm hover:underline">
              ← Stores
            </Link>
            <StoreSwitch currentId={storeId} />
          </div>

          <nav className="flex items-center gap-4">
            <NavLink href={`/store/${storeId}/entries`}>Entries</NavLink>
            <NavLink href={`/store/${storeId}/qbo-export`}>QBO Export</NavLink>
            <NavLink href={`/store/${storeId}/settings`}>Settings</NavLink>
            <NavLink href={`/store/${storeId}/admin`}>Admin</NavLink>
          </nav>
        </div>

        {children}
      </div>
    </Suspense>
  );
}
