'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '@/lib/firebase';

function EyeIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.477 0 8.268 2.943 9.542 7-1.274 4.057-5.065 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
      <circle cx="12" cy="12" r="3" strokeWidth="2" />
    </svg>
  );
}

function EyeOffIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        d="M3 3l18 18M10.585 10.585A3 3 0 0113.415 13.415M9.88 4.59A9.956 9.956 0 0112 4c4.477 0 8.268 2.943 9.542 7a10.523 10.523 0 01-2.108 3.592M6.61 6.61C4.94 7.7 3.732 9.59 2.458 12c1.274 4.057 5.065 7 9.542 7a9.96 9.96 0 004.39-1.01" />
    </svg>
  );
}

export default function LoginPage() {
  const r = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false); // NEW
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

          {/* Password with show/hide toggle */}
          <label className="sr-only" htmlFor="password">Password</label>
          <div className="relative">
            <input
              id="password"
              className="w-full rounded-lg p-3 pr-10 border outline-none"
              placeholder="Password"
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
            <button
              type="button"
              onClick={() => setShowPw(p => !p)}
              aria-pressed={showPw}
              aria-label={showPw ? 'Hide password' : 'Show password'}
              className="absolute inset-y-0 right-0 px-3 flex items-center text-slate-500 hover:text-slate-700"
            >
              {showPw ? <EyeOffIcon className="w-5 h-5" /> : <EyeIcon className="w-5 h-5" />}
            </button>
          </div>

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
