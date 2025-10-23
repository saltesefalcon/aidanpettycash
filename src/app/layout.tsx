import './globals.css';
import type { ReactNode } from 'react';
import AppShell from '@/components/AppShell';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-800 antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
