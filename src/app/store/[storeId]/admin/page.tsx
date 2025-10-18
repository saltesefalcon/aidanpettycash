"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { db } from "@/lib/firebase";
import {
  addDoc,
  setDoc,
  doc,
  collection,
  query,
  where,
  getDoc,
  getDocs,
  Timestamp,
} from "firebase/firestore";

// ── Types ───────────────────────────────────────────────────────────
type CashIn = { id?: string; date: any; amount: number; source?: string; note?: string };
type Opening = { amount: number; note?: string; createdAt?: any };
type Deposit = { id?: string; date: any; amount: number; method?: string; note?: string };
type Audit = {
  id?: string;
  date: any;
  n5: number; n10: number; n20: number; n50: number; n100: number;
  change: number; // loose bills/coins in dollars
  total: number;  // computed counted cash
  note?: string;
};

export default function AdminPage() {
  const { storeId } = useParams<{ storeId: string }>();

  // ── Month picker defaults to current month (YYYY-MM) ──────────────
  const [month, setMonth] = useState(() => {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}`;
  });

  // ── QBO export options (appear near month selector) ───────────────
  const [journalNo, setJournalNo] = useState<string>("");
  const [includeCashIns, setIncludeCashIns] = useState<boolean>(false);
  const [cashInCreditAccount, setCashInCreditAccount] = useState<string>("1000 Bank");

  const monthStartEnd = (ym: string) => {
    const [y, m] = ym.split("-").map(Number);
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 0);
    const ymd = (d: Date) => d.toISOString().slice(0, 10);
    return { from: ymd(start), to: ymd(end) };
  };

  // Client helper: open the API route that generates the CSV (download)
  function downloadCsvForMonthClient() {
    if (!storeId || !month) return;
    const { from, to } = monthStartEnd(month);
    const params = new URLSearchParams({ from, to });

    if (journalNo && journalNo.trim()) params.set("jn", journalNo.trim());
    if (includeCashIns) {
      params.set("includeCashIns", "1");
      if (cashInCreditAccount) params.set("cashInCreditAccount", cashInCreditAccount);
    }

    window.open(
      `/api/store/${storeId}/qbo-export?${params.toString()}`,
      "_blank",
      "noopener,noreferrer"
    );
  }

  // NEW: Preview helper — returns JSON (no file), ensures no 500s while testing
  function previewCsvForMonthClient() {
    if (!storeId || !month) return;
    const { from, to } = monthStartEnd(month);
    const params = new URLSearchParams({ from, to, debug: "1", preview: "1" });

    if (journalNo && journalNo.trim()) params.set("jn", journalNo.trim());
    if (includeCashIns) {
      params.set("includeCashIns", "1");
      if (cashInCreditAccount) params.set("cashInCreditAccount", cashInCreditAccount);
    }

    window.open(
      `/api/store/${storeId}/qbo-export?${params.toString()}`,
      "_blank",
      "noopener,noreferrer"
    );
  }

  // ── Opening balance state ──────────────────────────────────────────
  const [openingAmt, setOpeningAmt] = useState<string>("");
  const [openingNote, setOpeningNote] = useState<string>("");
  const [openLoaded, setOpenLoaded] = useState(false);

  // ── Cash-in form ──────────────────────────────────────────────────
  const [ciDate, setCiDate] = useState(() => {
    const t = new Date();
    const mm = String(t.getMonth() + 1).padStart(2, "0");
    const dd = String(t.getDate()).padStart(2, "0");
    return `${t.getFullYear()}-${mm}-${dd}`;
  });
  const [ciAmount, setCiAmount] = useState<string>("");
  const [ciSource, setCiSource] = useState<string>("");
  const [ciNote, setCiNote] = useState<string>("");

  // ── Deposits form ─────────────────────────────────────────────────
  const [depDate, setDepDate] = useState(() => {
    const t = new Date();
    const mm = String(t.getMonth() + 1).padStart(2, "0");
    const dd = String(t.getDate()).padStart(2, "0");
    return `${t.getFullYear()}-${mm}-${dd}`;
  });
  const [depAmount, setDepAmount] = useState<string>("");
  const [depMethod, setDepMethod] = useState<string>("Bank");
  const [depNote, setDepNote] = useState<string>("");

  // ── Audit form ────────────────────────────────────────────────────
  const [auditDate, setAuditDate] = useState(() => {
    const t = new Date();
    const mm = String(t.getMonth() + 1).padStart(2, "0");
    const dd = String(t.getDate()).padStart(2, "0");
    return `${t.getFullYear()}-${mm}-${dd}`;
  });
  const [n5, setN5] = useState<string>("0");
  const [n10, setN10] = useState<string>("0");
  const [n20, setN20] = useState<string>("0");
  const [n50, setN50] = useState<string>("0");
  const [n100, setN100] = useState<string>("0");
  const [chg, setChg] = useState<string>("0");
  const [audits, setAudits] = useState<Audit[]>([]);

  // helpers + computed
  const num = (s: string) => Number.parseFloat(s || "0");
  const counted = useMemo(
    () => num(n5) * 5 + num(n10) * 10 + num(n20) * 20 + num(n50) * 50 + num(n100) * 100 + num(chg),
    [n5, n10, n20, n50, n100, chg]
  );

  // ── Data (lists & rollups) ────────────────────────────────────────
  const [cashIns, setCashIns] = useState<CashIn[]>([]);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [entriesSum, setEntriesSum] = useState<number>(0);

  // Opening balance load
  useEffect(() => {
    if (!storeId || !month) return;
    setOpenLoaded(false);
    (async () => {
      const ref = doc(db, "stores", storeId, "openingBalances", month);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const d = snap.data() as Opening;
        setOpeningAmt(String(d.amount ?? ""));
        setOpeningNote(d.note ?? "");
      } else {
        setOpeningAmt("");
        setOpeningNote("");
      }
      setOpenLoaded(true);
    })();
  }, [storeId, month]);

  // Cash-ins by month (client sort, no composite index)
  useEffect(() => {
    if (!storeId || !month) return;
    (async () => {
      const qy = query(collection(db, "stores", storeId, "cashins"), where("month", "==", month));
      const snap = await getDocs(qy);
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      rows.sort(
        (a: any, b: any) =>
          (a.date?.toDate?.() ?? new Date(0)).getTime() -
          (b.date?.toDate?.() ?? new Date(0)).getTime()
      );
      setCashIns(rows as CashIn[]);
    })();
  }, [storeId, month]);

  // Deposits by month (tracker only)
  useEffect(() => {
    if (!storeId || !month) return;
    (async () => {
      const qy = query(collection(db, "stores", storeId, "deposits"), where("month", "==", month));
      const snap = await getDocs(qy);
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      rows.sort(
        (a: any, b: any) =>
          (a.date?.toDate?.() ?? new Date(0)).getTime() -
          (b.date?.toDate?.() ?? new Date(0)).getTime()
      );
      setDeposits(rows as Deposit[]);
    })();
  }, [storeId, month]);

  // Audits by month
  useEffect(() => {
    if (!storeId || !month) return;
    (async () => {
      const qy = query(collection(db, "stores", storeId, "audits"), where("month", "==", month));
      const snap = await getDocs(qy);
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      rows.sort(
        (a: any, b: any) =>
          (a.date?.toDate?.() ?? new Date(0)).getTime() -
          (b.date?.toDate?.() ?? new Date(0)).getTime()
      );
      setAudits(rows as Audit[]);
    })();
  }, [storeId, month]);

  // Sum entries (gross) for month
  useEffect(() => {
    if (!storeId || !month) return;
    (async () => {
      const qy = query(collection(db, "stores", storeId, "entries"), where("month", "==", month));
      const snap = await getDocs(qy);
      let total = 0;
      snap.forEach((d) => (total += Number(d.data().amount || 0)));
      setEntriesSum(Number(total.toFixed(2)));
    })();
  }, [storeId, month]);

  const cashInSum = useMemo(
    () => Number(cashIns.reduce((s, r) => s + Number(r.amount || 0), 0).toFixed(2)),
    [cashIns]
  );
  const depositsSum = useMemo(
    () => Number(deposits.reduce((s, r) => s + Number(r.amount || 0), 0).toFixed(2)),
    [deposits]
  );

  const opening = Number.parseFloat(openingAmt || "0");
  const closing = useMemo(
    () => Number((opening + cashInSum - entriesSum).toFixed(2)),
    [opening, cashInSum, entriesSum]
  );

  const variance = useMemo(() => Number((counted - closing).toFixed(2)), [counted, closing]);

  // ── Save handlers ─────────────────────────────────────────────────
  async function saveOpening(e: React.FormEvent) {
    e.preventDefault();
    if (!storeId || !month) return;
    await setDoc(doc(db, "stores", storeId, "openingBalances", month), {
      amount: Number.parseFloat(openingAmt || "0"),
      note: openingNote,
      createdAt: Timestamp.now(),
    });
    alert("Opening balance saved.");
  }

  async function saveCashIn(e: React.FormEvent) {
    e.preventDefault();
    if (!storeId || !ciAmount) return;
    const when = Timestamp.fromDate(new Date(`${ciDate}T00:00:00`));
    await addDoc(collection(db, "stores", storeId, "cashins"), {
      date: when,
      amount: Number.parseFloat(ciAmount),
      source: ciSource,
      note: ciNote,
      month,
      createdAt: Timestamp.now(),
    });
    setCiAmount("");
    setCiSource("");
    setCiNote("");

    // refresh
    const qy = query(collection(db, "stores", storeId, "cashins"), where("month", "==", month));
    const snap = await getDocs(qy);
    const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
    rows.sort(
      (a: any, b: any) =>
        (a.date?.toDate?.() ?? new Date(0)).getTime() -
        (b.date?.toDate?.() ?? new Date(0)).getTime()
    );
    setCashIns(rows as CashIn[]);
  }

  async function saveDeposit(e: React.FormEvent) {
    e.preventDefault();
    if (!storeId || !depAmount) return;
    const when = Timestamp.fromDate(new Date(`${depDate}T00:00:00`));
    await addDoc(collection(db, "stores", storeId, "deposits"), {
      date: when,
      amount: Number.parseFloat(depAmount),
      method: depMethod,
      note: depNote,
      month,
      createdAt: Timestamp.now(),
    });
    setDepAmount("");
    setDepMethod("Bank");
    setDepNote("");

    // refresh
    const qy = query(collection(db, "stores", storeId, "deposits"), where("month", "==", month));
    const snap = await getDocs(qy);
    const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
    rows.sort(
      (a: any, b: any) =>
        (a.date?.toDate?.() ?? new Date(0)).getTime() -
        (b.date?.toDate?.() ?? new Date(0)).getTime()
    );
    setDeposits(rows as Deposit[]);
  }

  // NEW: audit save handler
  async function onSaveAudit(e: React.FormEvent) {
    e.preventDefault();
    if (!storeId) return;

    const when = Timestamp.fromDate(new Date(`${auditDate}T00:00:00`));
    const payload = {
      date: when,
      n5: num(n5),
      n10: num(n10),
      n20: num(n20),
      n50: num(n50),
      n100: num(n100),
      change: num(chg),
      total: Number(counted.toFixed(2)),
      month,
      createdAt: Timestamp.now(),
    };

    await addDoc(collection(db, "stores", storeId, "audits"), payload);

    // reset quick fields
    setN5("0");
    setN10("0");
    setN20("0");
    setN50("0");
    setN100("0");
    setChg("0");

    // refresh audits list
    const qy = query(collection(db, "stores", storeId, "audits"), where("month", "==", month));
    const snap = await getDocs(qy);
    const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
    rows.sort(
      (a: any, b: any) =>
        (a.date?.toDate?.() ?? new Date(0)).getTime() -
        (b.date?.toDate?.() ?? new Date(0)).getTime()
    );
    setAudits(rows as Audit[]);
  }

  const fmtDate = (ts?: any) => (ts?.toDate ? ts.toDate().toLocaleDateString("en-CA") : "");

  if (!storeId) return <main className="p-6">No store selected.</main>;

  // ── UI ────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen p-6">
      <h1 className="text-2xl font-semibold mb-2">Petty Cash — Admin</h1>

      {/* Month selector & rollup + QBO options */}
      <div className="mb-6 flex flex-col gap-4">
        <div className="flex items-end gap-6">
          <div>
            <label className="block text-sm mb-1">Month</label>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="border px-3 py-2 rounded"
            />
          </div>
          <div className="text-sm">
            <div>
              Entries (gross): <strong>${entriesSum.toFixed(2)}</strong>
            </div>
            <div>
              Cash in: <strong>${cashInSum.toFixed(2)}</strong>
            </div>
            <div>
              Opening: <strong>${opening.toFixed(2)}</strong>
            </div>
            <div className="mt-1">
              Projected closing: <strong>${closing.toFixed(2)}</strong>
            </div>
            <div className="mt-1 opacity-80">
              Deposits (tracker): <strong>${depositsSum.toFixed(2)}</strong>
            </div>
          </div>
        </div>

        {/* QBO CSV options + buttons */}
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-sm mb-1">Journal # (optional)</label>
            <input
              type="text"
              value={journalNo}
              onChange={(e) => setJournalNo(e.target.value)}
              className="border px-3 py-2 rounded"
              placeholder="e.g., PC-20251012"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              id="incl-ci"
              type="checkbox"
              checked={includeCashIns}
              onChange={(e) => setIncludeCashIns(e.target.checked)}
            />
            <label htmlFor="incl-ci" className="text-sm">
              Include cash-ins
            </label>
          </div>
          <div>
            <label className="block text-sm mb-1">Cash-in credit account</label>
            <input
              type="text"
              value={cashInCreditAccount}
              onChange={(e) => setCashInCreditAccount(e.target.value)}
              className="border px-3 py-2 rounded"
              disabled={!includeCashIns}
              placeholder="1000 Bank"
            />
          </div>

          <div className="ml-auto flex gap-2">
            <button
              type="button"
              className="border px-3 py-2 rounded"
              onClick={previewCsvForMonthClient}
              title="Open a JSON preview with sample lines and balance totals"
            >
              Preview CSV
            </button>
            <button
              type="button"
              className="underline"
              onClick={downloadCsvForMonthClient}
              title="Download the actual CSV"
            >
              Download CSV for {month}
            </button>
          </div>
        </div>
      </div>

      {/* Opening balance */}
      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-2">Opening balance</h2>
        <form onSubmit={saveOpening} className="grid grid-cols-3 gap-3 max-w-3xl">
          <div>
            <label className="block text-sm mb-1">Amount</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={openingAmt}
              onChange={(e) => setOpeningAmt(e.target.value)}
              className="border px-3 py-2 rounded w-full"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-sm mb-1">Note</label>
            <input
              type="text"
              value={openingNote}
              onChange={(e) => setOpeningNote(e.target.value)}
              className="border px-3 py-2 rounded w-full"
            />
          </div>
          <div>
            <button className="border px-4 py-2 rounded mt-6">Save opening</button>
          </div>
          {!openLoaded && <div className="col-span-3 text-sm">Loading…</div>}
        </form>
      </section>

      {/* Cash in */}
      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-2">Cash in (refill)</h2>
        <form onSubmit={saveCashIn} className="grid grid-cols-4 gap-3 max-w-4xl">
          <div>
            <label className="block text-sm mb-1">Date</label>
            <input
              type="date"
              value={ciDate}
              onChange={(e) => setCiDate(e.target.value)}
              className="border px-3 py-2 rounded w-full"
              required
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Amount</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={ciAmount}
              onChange={(e) => setCiAmount(e.target.value)}
              className="border px-3 py-2 rounded w-full"
              required
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Source</label>
            <input
              type="text"
              value={ciSource}
              onChange={(e) => setCiSource(e.target.value)}
              className="border px-3 py-2 rounded w-full"
              placeholder="Cash Sales / Bank / etc."
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Note</label>
            <input
              type="text"
              value={ciNote}
              onChange={(e) => setCiNote(e.target.value)}
              className="border px-3 py-2 rounded w-full"
            />
          </div>
          <div className="col-span-4">
            <button className="border px-4 py-2 rounded">Add cash in</button>
          </div>
        </form>

        {/* List cash-ins */}
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-[560px] text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2 pr-4">Date</th>
                <th className="py-2 pr-4">Amount</th>
                <th className="py-2 pr-4">Source</th>
                <th className="py-2 pr-4">Note</th>
              </tr>
            </thead>
            <tbody>
              {cashIns.map((ci) => (
                <tr key={ci.id} className="border-b last:border-b-0">
                  <td className="py-2 pr-4">{fmtDate(ci.date)}</td>
                  <td className="py-2 pr-4">{Number(ci.amount || 0).toFixed(2)}</td>
                  <td className="py-2 pr-4">{ci.source ?? ""}</td>
                  <td className="py-2 pr-4">{ci.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Deposits tracker */}
      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-2">Deposits (tracker)</h2>
        <form onSubmit={saveDeposit} className="grid grid-cols-4 gap-3 max-w-4xl">
          <div>
            <label className="block text-sm mb-1">Date</label>
            <input
              type="date"
              value={depDate}
              onChange={(e) => setDepDate(e.target.value)}
              className="border px-3 py-2 rounded w-full"
              required
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Amount</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={depAmount}
              onChange={(e) => setDepAmount(e.target.value)}
              className="border px-3 py-2 rounded w-full"
              required
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Method</label>
            <input
              type="text"
              value={depMethod}
              onChange={(e) => setDepMethod(e.target.value)}
              className="border px-3 py-2 rounded w-full"
              placeholder="Bank / Cash pickup / etc."
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Note</label>
            <input
              type="text"
              value={depNote}
              onChange={(e) => setDepNote(e.target.value)}
              className="border px-3 py-2 rounded w-full"
            />
          </div>
          <div className="col-span-4">
            <button className="border px-4 py-2 rounded">Add deposit</button>
          </div>
        </form>

        {/* List deposits */}
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-[560px] text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2 pr-4">Date</th>
                <th className="py-2 pr-4">Amount</th>
                <th className="py-2 pr-4">Method</th>
                <th className="py-2 pr-4">Note</th>
              </tr>
            </thead>
            <tbody>
              {deposits.map((d) => (
                <tr key={d.id} className="border-b last:border-b-0">
                  <td className="py-2 pr-4">{fmtDate(d.date)}</td>
                  <td className="py-2 pr-4">{Number(d.amount || 0).toFixed(2)}</td>
                  <td className="py-2 pr-4">{d.method ?? ""}</td>
                  <td className="py-2 pr-4">{d.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Audit & denominations */}
      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-2">Petty cash audit &amp; denominations</h2>

        <form onSubmit={onSaveAudit} className="grid grid-cols-7 gap-3 max-w-5xl items-end">
          <div className="col-span-2">
            <label className="block text-sm mb-1">Date</label>
            <input
              type="date"
              value={auditDate}
              onChange={(e) => setAuditDate(e.target.value)}
              className="border px-3 py-2 rounded w-full"
              required
            />
          </div>

          <div>
            <label className="block text-xs mb-1">$5 count</label>
            <input
              type="number"
              min="0"
              value={n5}
              onChange={(e) => setN5(e.target.value)}
              className="border px-3 py-2 rounded w-full"
            />
          </div>
          <div>
            <label className="block text-xs mb-1">$10 count</label>
            <input
              type="number"
              min="0"
              value={n10}
              onChange={(e) => setN10(e.target.value)}
              className="border px-3 py-2 rounded w-full"
            />
          </div>
          <div>
            <label className="block text-xs mb-1">$20 count</label>
            <input
              type="number"
              min="0"
              value={n20}
              onChange={(e) => setN20(e.target.value)}
              className="border px-3 py-2 rounded w-full"
            />
          </div>
          <div>
            <label className="block text-xs mb-1">$50 count</label>
            <input
              type="number"
              min="0"
              value={n50}
              onChange={(e) => setN50(e.target.value)}
              className="border px-3 py-2 rounded w-full"
            />
          </div>
          <div>
            <label className="block text-xs mb-1">$100 count</label>
            <input
              type="number"
              min="0"
              value={n100}
              onChange={(e) => setN100(e.target.value)}
              className="border px-3 py-2 rounded w-full"
            />
          </div>

          <div className="col-span-2">
            <label className="block text-sm mb-1">Change ($)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={chg}
              onChange={(e) => setChg(e.target.value)}
              className="border px-3 py-2 rounded w-full"
            />
          </div>

          <div className="col-span-3 text-sm">
            <div>
              Counted total: <strong>${counted.toFixed(2)}</strong>
            </div>
            <div className={variance === 0 ? "" : variance > 0 ? "text-green-700" : "text-red-700"}>
              Variance vs projected closing:{" "}
              <strong>
                {variance >= 0 ? "+" : ""}${variance.toFixed(2)}
              </strong>
            </div>
          </div>

          <div className="col-span-2">
            <button className="border px-4 py-2 rounded">Save audit</button>
          </div>
        </form>

        {/* Recent audits */}
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-[560px] text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2 pr-4">Date</th>
                <th className="py-2 pr-4">Counted total</th>
                <th className="py-2 pr-4">Variance (vs closing at time)</th>
              </tr>
            </thead>
            <tbody>
              {audits.slice(-5).map((a) => {
                const dt = a.date?.toDate?.() ?? new Date();
                const v = (Number(a.total || 0) - closing).toFixed(2);
                return (
                  <tr key={a.id} className="border-b last:border-b-0">
                    <td className="py-2 pr-4">{dt.toLocaleDateString("en-CA")}</td>
                    <td className="py-2 pr-4">${Number(a.total || 0).toFixed(2)}</td>
                    <td className="py-2 pr-4">{v}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Next widgets */}
      <section className="opacity-70">
        <h2 className="text-xl font-semibold mb-2">More admin widgets (next)</h2>
        <ul className="list-disc ml-6 text-sm">
          <li>Petty cash audit &amp; bill denominations calculator</li>
        </ul>
      </section>
    </main>
  );
}
