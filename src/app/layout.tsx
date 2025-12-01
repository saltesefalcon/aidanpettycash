// src/app/layout.tsx
import './globals.css';
import type { ReactNode } from 'react';

import AppShell from '@/components/AppShell';
import SessionGuard from '@/components/SessionGuard';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      {/* Remove 'antialiased' to avoid vendor font-smoothing warnings */}
      <body className="min-h-screen bg-slate-50 text-slate-800">
        <SessionGuard>
          <AppShell>{children}</AppShell>
        </SessionGuard>
      </body>
    </html>
  );
}
