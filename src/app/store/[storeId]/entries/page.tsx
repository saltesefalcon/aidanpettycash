"use client";

import React from "react";
import { useParams } from "next/navigation";
import { db } from "@/lib/firebase";
import {
  addDoc,
  collection,
  getDocs,
  orderBy,
  query,
  limit,
  Timestamp,
  onSnapshot, 
  deleteDoc,
  doc,
} from "firebase/firestore";

type AccountDoc = { name: string };

function RecentEntries({ storeId }: { storeId: string }) {
  const [rows, setRows] = React.useState<Array<any>>([]);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!storeId) return;

    const qy = query(
      collection(db, "stores", storeId, "entries"),
      orderBy("date", "desc"),
      limit(5)
    );

    const unsub = onSnapshot(
      qy,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        setRows(list);
      },
      (err) => console.error("[entries] live query error:", err)
    );

    return () => unsub();
  }, [storeId]);


  const fmt = (ts?: any) =>
    ts?.toDate?.()?.toLocaleDateString?.("en-CA") ?? "";

  async function onDelete(id: string) {
    if (!storeId) return;
    if (!confirm("Delete this entry?")) return;
    try {
      setBusyId(id);
      await deleteDoc(doc(db, "stores", storeId, "entries", id));
      setRows((s) => s.filter((r) => r.id !== id));
    } finally {
      setBusyId(null);
    }
  }

  if (!rows.length) return null;

  return (
    <div className="mt-8 overflow-x-auto">
      <h3 className="font-semibold mb-2">Recent entries</h3>
      <table className="min-w-[760px] text-sm">
        <thead>
          <tr className="text-left border-b">
            <th className="py-2 pr-4">Date</th>
            <th className="py-2 pr-4">Vendor</th>
            <th className="py-2 pr-4">Account</th>
            <th className="py-2 pr-4">Amount</th>
            <th className="py-2 pr-4">HST</th>
            <th className="py-2 pr-4">Net</th>
            <th className="py-2 pr-4">Description</th>
            <th className="py-2 pr-4"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b last:border-b-0 align-top">
              <td className="py-2 pr-4">{fmt(r.date)}</td>
              <td className="py-2 pr-4">{r.vendor ?? ""}</td>
              <td className="py-2 pr-4">{r.account ?? ""}</td>
              <td className="py-2 pr-4">{Number(r.amount || 0).toFixed(2)}</td>
              <td className="py-2 pr-4">{Number(r.hst || 0).toFixed(2)}</td>
              <td className="py-2 pr-4">{Number(r.net || 0).toFixed(2)}</td>
              <td className="py-2 pr-4">{r.description ?? ""}</td>
              <td className="py-2 pr-4">
                <button
                  className="underline"
                  onClick={() => onDelete(r.id)}
                  disabled={busyId === r.id}
                  title="Delete entry"
                >
                  {busyId === r.id ? "Deleting…" : "Delete"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function EntriesPage() {
  const { storeId } = useParams<{ storeId: string }>();

  // ---- load Accounts for dropdown ----
  const [accounts, setAccounts] = React.useState<string[]>([]);
  const [loadingAccounts, setLoadingAccounts] = React.useState(true);
  const FORBIDDEN = "1050 Petty Cash"; // reserved

  React.useEffect(() => {
    if (!storeId) return;
    (async () => {
      setLoadingAccounts(true);
      try {
        const snap = await getDocs(collection(db, "stores", storeId, "accounts"));
        const names: string[] = [];
        snap.forEach((d) => {
          const data = d.data() as AccountDoc;
          if (data?.name) names.push(data.name);
        });
        names.sort((a, b) => a.localeCompare(b, "en"));
        setAccounts(names.filter((n) => n !== FORBIDDEN));
      } catch (err) {
        console.error("[entries] load accounts failed:", err);
        setAccounts([]); // fallback to manual input
      } finally {
        setLoadingAccounts(false);
      }
    })();
  }, [storeId]);

  // ---- vendor suggestions (recent vendors) ----
  const [vendors, setVendors] = React.useState<string[]>([]);
  React.useEffect(() => {
    if (!storeId) return;
    (async () => {
      const qy = query(
        collection(db, "stores", storeId, "entries"),
        orderBy("date", "desc"),
        limit(25)
      );
      const snap = await getDocs(qy);
      const set = new Set<string>();
      snap.forEach((d) => {
        const v = (d.data() as any)?.vendor;
        if (v && typeof v === "string") set.add(v);
      });
      setVendors(Array.from(set).sort((a, b) => a.localeCompare(b, "en")));
    })();
  }, [storeId]);

  // ---- add-entry form state ----
  const [date, setDate] = React.useState<string>(() => {
    const t = new Date();
    const mm = String(t.getMonth() + 1).padStart(2, "0");
    const dd = String(t.getDate()).padStart(2, "0");
    return `${t.getFullYear()}-${mm}-${dd}`;
  });
  const [vendor, setVendor] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [amount, setAmount] = React.useState<string>("");
  const [hst, setHst] = React.useState<string>("");
  const [account, setAccount] = React.useState<string>("");

  const amt = Number.parseFloat(amount || "0");
  const hstNum = Number.parseFloat(hst || "0");
  const net = React.useMemo(() => Number((amt - hstNum).toFixed(2)), [amt, hstNum]);
  const month = React.useMemo(() => date.slice(0, 7), [date]);

  function fillHst13() {
    if (!amount) return;
    const v = Math.round(amt * 0.13 * 100) / 100;
    setHst(v.toFixed(2));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!storeId || !account || !date || !amount) return;

    const when = Timestamp.fromDate(new Date(`${date}T00:00:00`));
    await addDoc(collection(db, "stores", storeId, "entries"), {
      date: when,
      vendor,
      description,
      amount: Number(amt.toFixed(2)),
      hst: Number(hstNum.toFixed(2)),
      net,
      account,
      type: "",
      month,
      createdAt: Timestamp.now(),
    });

    setVendor("");
    setDescription("");
    setAmount("");
    setHst("");
    setAccount("");
    alert("Entry added.");
  }

  if (!storeId) return <main className="p-6">No store selected.</main>;

  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Entries</h1>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">Add entry</h2>
        <form onSubmit={onSubmit} className="grid grid-cols-6 gap-3 max-w-5xl items-end">
          <div>
            <label className="block text-sm mb-1">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="border px-3 py-2 rounded w-full"
              required
            />
          </div>

          <div className="col-span-2">
            <label className="block text-sm mb-1">Vendor</label>
            <input
              list="vendors"
              type="text"
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              className="border px-3 py-2 rounded w-full"
              placeholder="Costco / LCBO / …"
            />
            <datalist id="vendors">
              {vendors.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </div>

          <div className="col-span-3">
            <label className="block text-sm mb-1">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="border px-3 py-2 rounded w-full"
              placeholder="Paper towels, etc."
            />
          </div>

          <div>
            <label className="block text-sm mb-1">Amount</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="border px-3 py-2 rounded w-full"
              required
            />
          </div>

          <div>
            <label className="block text-sm mb-1 flex items-center gap-2">
              HST
              <button
                type="button"
                className="underline text-xs"
                onClick={fillHst13}
                title="Fill with 13% of amount"
              >
                13%
              </button>
              <button
                type="button"
                className="underline text-xs"
                onClick={() => setHst("")}
                title="Clear HST"
              >
                clear
              </button>
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={hst}
              onChange={(e) => setHst(e.target.value)}
              className="border px-3 py-2 rounded w-full"
              placeholder="e.g., 13.00"
            />
          </div>

          <div>
            <label className="block text-sm mb-1">Net</label>
            <input
              type="number"
              step="0.01"
              value={Number.isFinite(net) ? net : 0}
              readOnly
              className="border px-3 py-2 rounded w-full bg-gray-50"
            />
          </div>

          <div className="col-span-3">
            <label className="block text-sm mb-1">Account (from template)</label>

            {(!loadingAccounts && accounts.length === 0) ? (
              <>
                <input
                  type="text"
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  className="border px-3 py-2 rounded w-full"
                  placeholder="Type account exactly as in the Accounts list"
                  required
                />
                <p className="text-xs mt-1 text-amber-700">
                  Couldn’t load Accounts (check Firestore rules). You can type it exactly for now.
                </p>
              </>
            ) : (
              <select
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                className="border px-3 py-2 rounded w-full"
                disabled={loadingAccounts}
                required
              >
                <option value="" disabled>
                  {loadingAccounts ? "Loading accounts…" : "Select account"}
                </option>
                {accounts.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            )}

            <p className="text-xs mt-1 opacity-70">
              “1050 Petty Cash” is reserved for the month-end offset and is hidden here.
            </p>
          </div>

          <div className="col-span-6">
            <button className="border px-4 py-2 rounded">Add entry</button>
          </div>
        </form>
      </section>

      <RecentEntries storeId={storeId} />
    </main>
  );
}

