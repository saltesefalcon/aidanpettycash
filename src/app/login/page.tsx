'use client';

import { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const r = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      r.push('/dashboard');
    } catch (e: any) {
      setErr(e.message ?? 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={onSubmit} className="w-full max-w-sm bg-brand-card p-6 rounded-2xl shadow">
        <h1 className="text-2xl font-semibold mb-4">Aidan Petty Cash</h1>
        <div className="space-y-3">
          <input className="w-full rounded-lg p-3 bg-black/40 outline-none"
                 placeholder="Email" type="email" value={email} onChange={e=>setEmail(e.target.value)} />
          <input className="w-full rounded-lg p-3 bg-black/40 outline-none"
                 placeholder="Password" type="password" value={password} onChange={e=>setPassword(e.target.value)} />
          {err && <div className="text-red-400 text-sm">{err}</div>}
          <button disabled={busy}
                  className="w-full rounded-xl py-3 font-medium bg-brand-accent/90 hover:bg-brand-accent transition disabled:opacity-60">
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
      </form>
    </div>
  );
}
