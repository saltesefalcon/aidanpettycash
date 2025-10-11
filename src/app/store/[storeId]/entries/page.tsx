"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

// ⬇️ Adjust this import if your Firestore client lives elsewhere
import { db } from "@/lib/firebase";

import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  limit,
} from "firebase/firestore";

type Account = { id: string; name: string };

export default function EntriesPage() {
  const router = useRouter();
  const params = useParams<{ storeId: string }>();
  const storeId = params?.storeId;

  // ---------- form state ----------
  const [date, setDate] = useState<string>(() => {
    const t = new Date();
    const mm = String(t.getMonth() + 1).padStart(2, "0");
    const dd = String(t.getDate()).padStart(2, "0");
    return `${t.getFullYear()}-${mm}-${dd}`;
  });
  const [vendor, setVendor] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState<string>(""); // gross
  const [hst, setHst] = useState<string>(""); // tax portion
  const [type, setType] = useState<"FOH" | "BOH" | "OTHER" | "TRAVEL">("FOH");
  const [account, setAccount] = useState<string>("");

  // ---------- ui state ----------
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ---------- accounts dropdown ----------
  const [accounts, setAccounts] = useState<Account[]>([]);

  useEffect(() => {
    if (!storeId) return;
    const q = query(
      collection(db, "stores", storeId, "accounts"),
      // if you didn’t store a "name" field, remove orderBy
      orderBy("name")
    );
    const unsub = onSnapshot(q, (snap) => {
      const rows: Account[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return { id: d.id, name: data?.name ?? d.id };
      });
      setAccounts(rows);
      if (!account && rows.length) setAccount(rows[0].name);
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  // ---------- derived net = amount - hst ----------
  const net = useMemo(() => {
    const a = Number.parseFloat(amount || "0");
    const h = Number.parseFloat(hst || "0");
    const n = a - h;
    return Number.isFinite(n) ? n : 0;
  }, [amount, hst]);

  // ---------- submit ----------
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setError(null);

    if (!storeId) {
      setError("Missing storeId in route.");
      return;
    }
    if (!account) {
      setError("Please select an account (Settings → Accounts).");
      return;
    }
    if (!amount || Number.isNaN(Number.parseFloat(amount))) {
      setError("Please enter a valid Amount.");
      return;
    }
    if (!hst || Number.isNaN(Number.parseFloat(hst))) {
      setError("Please enter a valid HST (use 0 if none).");
      return;
    }

    try {
      setSaving(true);

      // convert yyyy-mm-dd to Firestore Timestamp (local midnight)
      const when = Timestamp.fromDate(new Date(`${date}T00:00:00`));
      // add month key "YYYY-MM" for month-based queries/rollups
      const monthKey = date.slice(0, 7);

      await addDoc(collection(db, "stores", storeId, "entries"), {
        date: when,
        month: monthKey,                   // ⬅️ new field
        vendor: vendor.trim(),
        description: description.trim(),
        amount: Number.parseFloat(amount), // gross
        hst: Number.parseFloat(hst),
        net: Number.parseFloat((net as number).toFixed(2)),
        type,
        account, // visible name (e.g., "1050 Petty Cash")
        createdAt: serverTimestamp(),
      });

      setMessage("Saved!");
      // reset quick-entry fields; keep date/account/type
      setVendor("");
      setDescription("");
      setAmount("");
      setHst("");
    } catch (err: any) {
      console.error(err);
      setError(err?.message ?? "Failed to save entry.");
    } finally {
      setSaving(false);
    }
  }

  if (!storeId) return <main className="p-6">No store selected.</main>;

  return (
    <main className="min-h-screen p-6">
      <h1 className="text-2xl font-semibold mb-2">Petty Cash — Entries</h1>
	  <p className="mb-4 text-sm">
  Store: <strong>{String(storeId)}</strong> ·{" "}
  <a className="underline" href={`/store/${storeId}/admin`}>Admin</a>
</p>

      {!accounts.length ? (
        <div className="mb-6 p-3 border rounded-md">
          <p className="mb-2">
            No Accounts found for this store. Go to{" "}
            <button
              type="button"
              onClick={() => router.push(`/store/${storeId}/settings`)}
              className="underline"
            >
              Settings → Accounts
            </button>{" "}
            to add/import accounts.
          </p>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-4 max-w-xl">
        <div>
          <label className="block text-sm mb-1">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full border px-3 py-2 rounded"
            required
          />
        </div>

        <div>
          <label className="block text-sm mb-1">Vendor</label>
          <input
            type="text"
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            className="w-full border px-3 py-2 rounded"
            placeholder="Costco, LCBO, etc."
            required
          />
        </div>

        <div>
          <label className="block text-sm mb-1">Description</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full border px-3 py-2 rounded"
            placeholder="Paper towels"
            required
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-sm mb-1">Amount (gross)</label>
            <input
              inputMode="decimal"
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full border px-3 py-2 rounded"
              required
            />
          </div>
          <div>
            <label className="block text-sm mb-1">HST</label>
            <input
              inputMode="decimal"
              type="number"
              step="0.01"
              min="0"
              value={hst}
              onChange={(e) => setHst(e.target.value)}
              className="w-full border px-3 py-2 rounded"
              required
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Net (auto)</label>
            <input
              type="number"
              readOnly
              value={Number.isFinite(net) ? net : 0}
              className="w-full border px-3 py-2 rounded bg-gray-50"
              tabIndex={-1}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm mb-1">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as any)}
              className="w-full border px-3 py-2 rounded"
            >
              <option value="FOH">FOH</option>
              <option value="BOH">BOH</option>
              <option value="OTHER">OTHER</option>
              <option value="TRAVEL">TRAVEL</option>
            </select>
          </div>
          <div>
            <label className="block text-sm mb-1">Account</label>
            <select
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              className="w-full border px-3 py-2 rounded"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.name}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving || !accounts.length}
            className="border px-4 py-2 rounded"
          >
            {saving ? "Saving…" : "Save entry"}
          </button>
          {message && <span className="text-green-700">{message}</span>}
          {error && <span className="text-red-700">{error}</span>}
        </div>
      </form>

      {/* Recent list appears under the form */}
      <RecentEntries storeId={String(storeId)} />
    </main>
  );
}

// ──────────────────────────────────────────────────────────────
// RecentEntries component (file-scope, outside EntriesPage)
// ──────────────────────────────────────────────────────────────
function RecentEntries({ storeId }: { storeId: string }) {
  const [rows, setRows] = useState<Array<any>>([]);

  useEffect(() => {
    if (!storeId) return;
    const qy = query(
      collection(db, "stores", storeId, "entries"),
      orderBy("date", "desc"),
      limit(25)
    );
    const unsub = onSnapshot(qy, (snap) => {
      setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
    });
    return () => unsub();
  }, [storeId]);

  const fmtDate = (ts?: any) =>
    ts?.toDate ? ts.toDate().toLocaleDateString("en-CA") : "";
  const money = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : "0.00");

  if (!rows.length) {
    return (
      <section className="mt-8">
        <h2 className="text-xl font-semibold mb-2">Recent entries</h2>
        <p className="text-sm text-gray-600">No entries yet.</p>
      </section>
    );
  }

  return (
    <section className="mt-8">
      <h2 className="text-xl font-semibold mb-2">Recent entries</h2>
      <div className="overflow-x-auto">
        <table className="min-w-[720px] text-sm">
          <thead>
            <tr className="text-left border-b">
              <th className="py-2 pr-4">Date</th>
              <th className="py-2 pr-4">Vendor</th>
              <th className="py-2 pr-4">Description</th>
              <th className="py-2 pr-4">Type</th>
              <th className="py-2 pr-4">Account</th>
              <th className="py-2 pr-4">Gross</th>
              <th className="py-2 pr-4">HST</th>
              <th className="py-2 pr-4">Net</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b last:border-b-0">
                <td className="py-2 pr-4">{fmtDate(r.date)}</td>
                <td className="py-2 pr-4">{r.vendor}</td>
                <td className="py-2 pr-4">{r.description}</td>
                <td className="py-2 pr-4">{r.type}</td>
                <td className="py-2 pr-4">{r.account}</td>
                <td className="py-2 pr-4">{money(r.amount)}</td>
                <td className="py-2 pr-4">{money(r.hst)}</td>
                <td className="py-2 pr-4">{money(r.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
