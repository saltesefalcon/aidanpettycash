// src/app/store/[storeId]/settings/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query,
  serverTimestamp, writeBatch
} from "firebase/firestore";
import { db, auth } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import MobileNav from "@/components/MobileNav";

type Account = { id: string; name: string; createdAt?: any };

export default function SettingsPage() {
  const { storeId } = useParams<{ storeId: string }>();
  const r = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [newName, setNewName] = useState("");
  const [bulk, setBulk] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => { if (!u) r.replace("/login"); });
    return () => unsub();
  }, [r]);

  useEffect(() => {
    const col = collection(db, "stores", String(storeId), "accounts");
    const q = query(col, orderBy("name"));
    const unsub = onSnapshot(q, (snap) => {
      const rows: Account[] = [];
      snap.forEach((d) => rows.push({ id: d.id, ...(d.data() as any) }));
      setAccounts(rows);
    });
    return () => unsub();
  }, [storeId]);

  async function addSingle() {
    const name = newName.trim(); if (!name) return;
    setBusy(true); setErr(null);
    try {
      const exists = accounts.some(a => a.name.toLowerCase() === name.toLowerCase());
      if (exists) throw new Error("That account already exists.");
      await addDoc(collection(db, "stores", String(storeId), "accounts"), { name, createdAt: serverTimestamp() });
      setNewName("");
    } catch (e:any) { setErr(e.message ?? "Failed to add"); }
    finally { setBusy(false); }
  }

  async function bulkImport() {
    const rows = bulk.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (rows.length === 0) return;
    setBusy(true); setErr(null);
    try {
      const existing = new Set(accounts.map(a => a.name.toLowerCase()));
      const unique = Array.from(new Set(rows)).filter(r => !existing.has(r.toLowerCase()));
      const b = writeBatch(db);
      unique.forEach((name) => {
        const ref = doc(collection(db, "stores", String(storeId), "accounts"));
        b.set(ref, { name, createdAt: serverTimestamp() });
      });
      await b.commit();
      setBulk("");
    } catch (e:any) { setErr(e.message ?? "Bulk import failed"); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    setBusy(true); setErr(null);
    try { await deleteDoc(doc(db, "stores", String(storeId), "accounts", id)); }
    catch (e:any) { setErr(e.message ?? "Delete failed"); }
    finally { setBusy(false); }
  }

  return (
    // 1) main + bottom padding so content clears fixed nav
    <main className="min-h-screen p-6 space-y-6 pb-24">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Settings → Accounts</h1>
        {/* 2) REMOVE the MobileNav from the header (was here) */}
        <a
          href={`/store/${storeId}`}
          className="rounded-xl px-3 py-2 bg-white/10 hover:bg-white/20"
        >
          Back to store
        </a>
      </div>

      {err && <div className="text-red-400">{err}</div>}

      <div className="grid gap-6 md:grid-cols-2">
        <div className="bg-brand-card p-4 rounded-2xl space-y-3">
          <h2 className="font-medium">Add single account</h2>
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-lg p-3 bg-black/40 outline-none"
              placeholder="e.g. 5100 Purchases:5120 Food Purchases"
              value={newName}
              onChange={(e)=>setNewName(e.target.value)}
            />
            <button
              onClick={addSingle}
              disabled={busy}
              className="rounded-xl px-4 py-2 bg-brand-accent/90 hover:bg-brand-accent text-black disabled:opacity-60"
            >
              Add
            </button>
          </div>
        </div>

        <div className="bg-brand-card p-4 rounded-2xl space-y-3">
          <h2 className="font-medium">Bulk import (one per line)</h2>
          <textarea
            className="w-full h-40 rounded-lg p-3 bg-black/40 outline-none"
            placeholder="Paste the Accounts column from your template (one per line)"
            value={bulk}
            onChange={(e)=>setBulk(e.target.value)}
          />
          <button
            onClick={bulkImport}
            disabled={busy}
            className="rounded-xl px-4 py-2 bg-brand-accent/90 hover:bg-brand-accent text-black disabled:opacity-60"
          >
            Import
          </button>
        </div>
      </div>

      <div className="bg-brand-card p-4 rounded-2xl">
        <h2 className="font-medium mb-3">Accounts ({accounts.length})</h2>
        <div className="divide-y divide-white/10">
          {accounts.map(a => (
            <div key={a.id} className="py-2 flex items-center justify-between">
              <div className="font-mono text-sm">{a.name}</div>
              <button
                onClick={()=>remove(a.id)}
                className="rounded-lg px-3 py-1 bg-white/10 hover:bg-white/20"
              >
                Remove
              </button>
            </div>
          ))}
          {accounts.length === 0 && <div className="opacity-70">No accounts yet.</div>}
        </div>
      </div>

      {/* 3) Spacer + fixed mobile nav at the very bottom */}
      <div className="h-16 md:hidden" />
      <MobileNav storeId={String(storeId)} />
    </main>
  );
}
