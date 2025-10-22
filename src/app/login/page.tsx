'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '@/lib/firebase';

export default function LoginPage() {
  const r = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [reasonMsg, setReasonMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Read ?reason=… after mount to avoid hydration issues
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const reason = sp.get('reason');
    if (reason === 'idle') setReasonMsg('You were signed out after 10 minutes of inactivity.');
    else if (reason === 'closed') setReasonMsg('You were signed out when the tab was closed.');
    else setReasonMsg(null);
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      r.replace('/dashboard');
    } catch (e: any) {
      setErr(e?.message ?? 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  async function onResetPassword() {
    setErr(null);
    setMsg(null);
    if (!email.trim()) {
      setErr('Enter your email above first.');
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setMsg('Password reset email sent.');
    } catch (e: any) {
      setErr(e?.message ?? 'Could not send reset email.');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={onSubmit} className="w-full max-w-sm bg-white p-6 rounded-2xl shadow space-y-4">
        <h1 className="text-2xl font-semibold">Aidan Petty Cash</h1>

        <div className="space-y-3">
          <input
            className="w-full rounded-lg p-3 border outline-none"
            placeholder="Email"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
          <input
            className="w-full rounded-lg p-3 border outline-none"
            placeholder="Password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />

          {/* feedback */}
          <div aria-live="polite" className="space-y-1">
            {err && <div className="text-red-600 text-sm">{err}</div>}
            {msg && <div className="text-green-600 text-sm">{msg}</div>}
            {reasonMsg && <div className="text-amber-600 text-sm">{reasonMsg}</div>}
          </div>

          <button
            disabled={busy}
            className="w-full rounded-xl py-3 font-medium bg-slate-900 text-white hover:bg-slate-800 transition disabled:opacity-60"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </div>

        <div className="flex items-center justify-between text-sm">
          <button type="button" onClick={onResetPassword} className="underline">
            Forgot password?
          </button>
          {/* Admin users link intentionally removed */}
        </div>
      </form>
    </div>
  );
}


