"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import {
  addDoc,
  setDoc,
  updateDoc,
  doc,
  collection,
  query,
  where,
  getDoc,
  getDocs,
  onSnapshot,          // <-- add this
  Timestamp,
} from "firebase/firestore";

import MonthPicker from "@/components/MonthPicker";
import MobileNav from "@/components/MobileNav";

// ── Types ───────────────────────────────────────────────────────────
type CashIn = {
  id?: string;
  date: any;
  amount: number;
  source?: string;
  note?: string;
  month?: string;
  createdAt?: any;
  createdByUid?: string;
  createdByName?: string;
  createdByEmail?: string;
  updatedAt?: any;
  updatedByUid?: string;
  updatedByName?: string;
  updatedByEmail?: string;
  deleted?: boolean;
  deletedAt?: any;
  deletedByUid?: string;
  deletedByName?: string;
  deletedByEmail?: string;
};

type Opening = { amount: number; note?: string; createdAt?: any };

type Deposit = {
  id?: string;
  date: any;
  amount: number;
  method?: string;
  note?: string;
  month?: string;
  createdAt?: any;
  createdByUid?: string;
  createdByName?: string;
  createdByEmail?: string;
  updatedAt?: any;
  updatedByUid?: string;
  updatedByName?: string;
  updatedByEmail?: string;
  deleted?: boolean;
  deletedAt?: any;
  deletedByUid?: string;
  deletedByName?: string;
  deletedByEmail?: string;
};

type Audit = {
  id?: string;
  date: any;
  n5: number; n10: number; n20: number; n50: number; n100: number;
  change: number;
  total: number;
  note?: string;
  createdAt?: any;
  createdByUid?: string; createdByName?: string; createdByEmail?: string;
  updatedAt?: any;
  updatedByUid?: string; updatedByName?: string; updatedByEmail?: string;
  deleted?: boolean;
  deletedAt?: any;
  deletedByUid?: string; deletedByName?: string; deletedByEmail?: string;
  month?: string;
};

export default function AdminPage() {
  const { storeId } = useParams<{ storeId: string }>();

  // Store display name for title
  const [storeName, setStoreName] = useState<string>(storeId || "");

  // Top-level error banner
  const [err, setErr] = useState<string | null>(null);

  // ── Month (shared MonthPicker) ─────────────────────────────────────
  const [month, setMonth] = useState(() => {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}`;
  });

  // ── QBO export options ────────────────────────────────────────────
  const [journalNo, setJournalNo] = useState<string>("");
  const [includeCashIns, setIncludeCashIns] = useState<boolean>(false);
  const [cashInCreditAccount, setCashInCreditAccount] = useState<string>("1000 Bank");

  // Fetch pretty store name for title
  useEffect(() => {
    if (!storeId) return;
    (async () => {
      try {
        const snap = await getDoc(doc(db, "stores", storeId));
        const name = (snap.data()?.name as string) || String(storeId);
        setStoreName(name);
      } catch {
        setStoreName(String(storeId));
      }
    })();
  }, [storeId]);

  const monthStartEnd = (ym: string) => {
    const [y, m] = ym.split("-").map(Number);
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 0);
    const ymd = (d: Date) => d.toISOString().slice(0, 10);
    return { from: ymd(start), to: ymd(end) };
  };

  // Download CSV
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

  // Preview (JSON – quick balance check & sample)
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

  // ── Helpers ───────────────────────────────────────────────────────
  const isoToday = () => {
    const t = new Date();
    const mm = String(t.getMonth() + 1).padStart(2, "0");
    const dd = String(t.getDate()).padStart(2, "0");
    return `${t.getFullYear()}-${mm}-${dd}`;
  };
  const toTs = (yyyyMmDd: string) =>
    Timestamp.fromDate(new Date(`${yyyyMmDd}T00:00:00`));
  // Safe getTime helper (works for Firestore Timestamps)
  const getTime = (val: any) => (val?.toDate ? val.toDate().getTime() : 0);

  // ── Opening balance state ──────────────────────────────────────────
  const [openingAmt, setOpeningAmt] = useState<string>("");
  const [openingNote, setOpeningNote] = useState<string>("");
  const [openLoaded, setOpenLoaded] = useState(false);

  // ── Cash-in form ──────────────────────────────────────────────────
  const [ciDate, setCiDate] = useState(isoToday());
  const [ciAmount, setCiAmount] = useState<string>("");
  const [ciSource, setCiSource] = useState<string>("");
  const [ciNote, setCiNote] = useState<string>("");
  const [showDeletedCashIns, setShowDeletedCashIns] = useState(false);

  // ── Deposits form (tracker only) ──────────────────────────────────
  const [depDate, setDepDate] = useState(isoToday());
  const [depAmount, setDepAmount] = useState<string>("");
  const [depMethod, setDepMethod] = useState<string>("Bank");
  const [depNote, setDepNote] = useState<string>("");
  const [showDeletedDeposits, setShowDeletedDeposits] = useState(false);

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
  const [showAudit, setShowAudit] = useState<boolean>(false); // hidden by default

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

  // ── Opening (computed for summary card: override else prev month's closing) ──
const [openingCard, setOpeningCard] = useState<number>(0);

useEffect(() => {
  if (!storeId || !month) return;
  (async () => {
    try {
      const v = await computeOpeningForMonth(String(storeId), month);
      setOpeningCard(v);
    } catch {
      // no-op; leave card at 0 on error
    }
  })();
}, [storeId, month]);


  // Opening balance load
  useEffect(() => {
    if (!storeId || !month) return;
    setOpenLoaded(false);
    (async () => {
      try {
        setErr(null);
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
      } catch (e: any) {
        setErr(e?.message || String(e));
      } finally {
        setOpenLoaded(true);
      }
    })();
  }, [storeId, month]);

  // Cash-ins by month (client sort; keep deleted in list for "Show deleted")
  useEffect(() => {
    if (!storeId || !month) return;
    (async () => {
      try {
        setErr(null);
        const qy = query(
          collection(db, "stores", String(storeId), "cashins"),
          where("month", "==", month)
        );
        const snap = await getDocs(qy);
        const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as CashIn[];
        rows.sort((a: any, b: any) => getTime(a.date) - getTime(b.date));
        setCashIns(rows);
      } catch (e: any) {
        setErr(e?.message || String(e));
        setCashIns([]);
      }
    })();
  }, [storeId, month]);

  // Deposits by month (tracker only)
  useEffect(() => {
    if (!storeId || !month) return;
    (async () => {
      try {
        setErr(null);
        const qy = query(collection(db, "stores", storeId, "deposits"), where("month", "==", month));
        const snap = await getDocs(qy);
        const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Deposit[];
        rows.sort((a: any, b: any) => getTime(a.date) - getTime(b.date));
        setDeposits(rows);
      } catch (e: any) {
        setErr(e?.message || String(e));
        setDeposits([]);
      }
    })();
  }, [storeId, month]);

  // Audits by month
  useEffect(() => {
    if (!storeId || !month) return;
    (async () => {
      try {
        setErr(null);
        const qy = query(collection(db, "stores", storeId, "audits"), where("month", "==", month));
        const snap = await getDocs(qy);
        const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        rows.sort((a: any, b: any) => getTime(a.date) - getTime(b.date));
        setAudits(rows as Audit[]);
      } catch (e: any) {
        setErr(e?.message || String(e));
        setAudits([]);
      }
    })();
  }, [storeId, month]);

// Sum entries (gross) for month (live, and ignore soft-deleted)
useEffect(() => {
  if (!storeId || !month) return;

  const qy = query(
    collection(db, "stores", String(storeId), "entries"),
    where("month", "==", month)
  );

  const unsub = onSnapshot(
    qy,
    (snap) => {
      let total = 0;
      snap.forEach((d) => {
        const x = d.data() as any;
        if (x.deleted === true) return;       // <-- ignore soft-deleted
        total += Number(x.amount || 0);
      });
      setEntriesSum(Number(total.toFixed(2)));
    },
    (e) => {
      setErr(e?.message || String(e));
      setEntriesSum(0);
    }
  );

  return () => unsub();
}, [storeId, month]);


  // Totals (ignore deleted)
  const cashInSum = useMemo(
    () =>
      Number(
        cashIns
          .filter((r) => !r.deleted)
          .reduce((s, r) => s + Number(r.amount || 0), 0)
          .toFixed(2)
      ),
    [cashIns]
  );
  const depositsSum = useMemo(
    () =>
      Number(
        deposits
          .filter((r) => !r.deleted)
          .reduce((s, r) => s + Number(r.amount || 0), 0)
          .toFixed(2)
      ),
    [deposits]
  );

  const opening = openingCard;
  const closing = useMemo(
    () => Number((opening + cashInSum - entriesSum).toFixed(2)),
    [opening, cashInSum, entriesSum]
  );

  const variance = useMemo(() => Number((counted - closing).toFixed(2)), [counted, closing]);

  const fmtDate = (ts?: any) =>
    ts?.toDate ? ts.toDate().toLocaleDateString("en-CA") : "";

  const isoDate = (ts?: any) =>
    ts?.toDate ? ts.toDate().toISOString().slice(0, 10) : "";

  const me = () => {
    const u = auth.currentUser;
    return {
      uid: u?.uid || "unknown",
      name: u?.displayName || u?.email || "unknown",
      email: u?.email || "",
    };
  };

  function StatCard({
    label,
    value,
    danger = false,
  }: { label: string; value: number; danger?: boolean }) {
    const cls =
      "mt-1 text-lg font-semibold tabular-nums " +
      (danger ? "text-red-700" : "text-gray-900");
    return (
      <div className="border rounded-lg px-4 py-3 min-w-[220px] bg-white">
        <div className="text-sm text-gray-700">{label}</div>
        <div className={cls}>
          {value < 0 ? `-$${Math.abs(value).toFixed(2)}` : `$${value.toFixed(2)}`}
        </div>
      </div>
    );
  }

  // ── Save handlers ─────────────────────────────────────────────────
  async function saveOpening(e: React.FormEvent) {
    e.preventDefault();
    if (!storeId || !month) return;
    try {
      setErr(null);
      await setDoc(doc(db, "stores", storeId, "openingBalances", month), {
        amount: Number.parseFloat(openingAmt || "0"),
        note: openingNote,
        createdAt: Timestamp.now(),
      });
      const v = await computeOpeningForMonth(String(storeId), month);
      setOpeningCard(v);
      alert("Opening balance saved.");
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  }

  async function saveCashIn(e: React.FormEvent) {
    e.preventDefault();
    if (!storeId || !ciAmount) return;
    try {
      setErr(null);
      const when = Timestamp.fromDate(new Date(`${ciDate}T00:00:00`));
      const user = me();
      await addDoc(collection(db, "stores", storeId, "cashins"), {
        date: when,
        amount: Number.parseFloat(ciAmount),
        source: ciSource,
        note: ciNote,
        month,
        createdAt: Timestamp.now(),
        createdByUid: user.uid,
        createdByName: user.name,
        createdByEmail: user.email,
        deleted: false,
      });
      setCiAmount("");
      setCiSource("");
      setCiNote("");

      // refresh
      const qy = query(collection(db, "stores", storeId, "cashins"), where("month", "==", month));
      const snap = await getDocs(qy);
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as CashIn[];
      rows.sort((a: any, b: any) => getTime(a.date) - getTime(b.date));
      setCashIns(rows);
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  }

  async function saveDeposit(e: React.FormEvent) {
    e.preventDefault();
    if (!storeId || !depAmount) return;
    try {
      setErr(null);
      const when = Timestamp.fromDate(new Date(`${depDate}T00:00:00`));
      const user = me();
      await addDoc(collection(db, "stores", storeId, "deposits"), {
        date: when,
        amount: Number.parseFloat(depAmount),
        method: depMethod,
        note: depNote,
        month,
        createdAt: Timestamp.now(),
        createdByUid: user.uid,
        createdByName: user.name,
        createdByEmail: user.email,
      });
      setDepAmount("");
      setDepMethod("Bank");
      setDepNote("");

      // refresh
      const qy = query(collection(db, "stores", storeId, "deposits"), where("month", "==", month));
      const snap = await getDocs(qy);
      const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Deposit[];
      rows.sort((a: any, b: any) => getTime(a.date) - getTime(b.date));
      setDeposits(rows);
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  }

  // ── Audit save handler ──────────────────────────────────────────────
  const onSaveAudit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeId) return;
    try {
      setErr(null);
      const when = Timestamp.fromDate(new Date(`${auditDate}T00:00:00`));
      const user = me();

      const payload: Omit<Audit, "id"> = {
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
        createdByUid: user.uid,
        createdByName: user.name,
        createdByEmail: user.email,
        deleted: false,
      };

      await addDoc(collection(db, "stores", storeId, "audits"), payload);

      // reset quick fields
      setN5("0"); setN10("0"); setN20("0"); setN50("0"); setN100("0"); setChg("0");

      // refresh list
      const qy = query(collection(db, "stores", storeId, "audits"), where("month", "==", month));
      const snap = await getDocs(qy);
      const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      rows.sort((a: any, b: any) => getTime(a.date) - getTime(b.date));
      setAudits(rows as Audit[]);
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  };

  // ── Audit soft-delete handler ───────────────────────────────────────
  async function onDeleteAudit(a: Audit) {
    if (!storeId || !a?.id) return;
    if (!confirm("Delete this audit?")) return;
    try {
      setErr(null);
      const user = me();
      await setDoc(
        doc(db, "stores", storeId, "audits", a.id),
        {
          deleted: true,
          deletedAt: Timestamp.now(),
          deletedByUid: user.uid,
          deletedByName: user.name,
          deletedByEmail: user.email,
          updatedAt: Timestamp.now(),
          updatedByUid: user.uid,
          updatedByName: user.name,
          updatedByEmail: user.email,
        },
        { merge: true }
      );

      // refresh
      const qy = query(collection(db, "stores", storeId, "audits"), where("month", "==", month));
      const snap = await getDocs(qy);
      const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      rows.sort((x: any, y: any) => getTime(x.date) - getTime(y.date));
      setAudits(rows as Audit[]);
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  }

  // ── Edit/Delete (soft delete) helpers ─────────────────────────────
  const [editingCashIn, setEditingCashIn] = useState<CashIn | null>(null);
  const [editingDeposit, setEditingDeposit] = useState<Deposit | null>(null);

  async function onEditCashInSave() {
    if (!storeId || !editingCashIn?.id) return;
    try {
      setErr(null);
      const user = me();
      await updateDoc(doc(db, "stores", storeId, "cashins", editingCashIn.id), {
        date: Timestamp.fromDate(new Date(`${isoDate(editingCashIn.date) || ciDate}T00:00:00`)),
        amount: Number(editingCashIn.amount || 0),
        source: editingCashIn.source || "",
        note: editingCashIn.note || "",
        month,
        updatedAt: Timestamp.now(),
        updatedByUid: user.uid,
        updatedByName: user.name,
        updatedByEmail: user.email,
      } as any);
      setEditingCashIn(null);

      // refresh
      const qy = query(collection(db, "stores", storeId, "cashins"), where("month", "==", month));
      const snap = await getDocs(qy);
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as CashIn[];
      rows.sort((a: any, b: any) => getTime(a.date) - getTime(b.date));
      setCashIns(rows);
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  }

  async function onDeleteCashIn(id?: string) {
    if (!storeId || !id) return;
    if (!confirm("Delete this cash-in?")) return;
    try {
      setErr(null);
      const user = me();
      await updateDoc(doc(db, "stores", storeId, "cashins", id), {
        deleted: true,
        deletedAt: Timestamp.now(),
        deletedByUid: user.uid,
        deletedByName: user.name,
        deletedByEmail: user.email,
      } as any);

      // refresh
      const qy = query(collection(db, "stores", storeId, "cashins"), where("month", "==", month));
      const snap = await getDocs(qy);
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as CashIn[];
      rows.sort((a: any, b: any) => getTime(a.date) - getTime(b.date));
      setCashIns(rows);
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  }

  async function onEditDepositSave() {
    if (!storeId || !editingDeposit?.id) return;
    try {
      setErr(null);
      const user = me();
      await updateDoc(doc(db, "stores", storeId, "deposits", editingDeposit.id), {
        date: Timestamp.fromDate(new Date(`${isoDate(editingDeposit.date) || depDate}T00:00:00`)),
        amount: Number(editingDeposit.amount || 0),
        method: editingDeposit.method || "",
        note: editingDeposit.note || "",
        month,
        updatedAt: Timestamp.now(),
        updatedByUid: user.uid,
        updatedByName: user.name,
        updatedByEmail: user.email,
      } as any);
      setEditingDeposit(null);

      const qy = query(collection(db, "stores", storeId, "deposits"), where("month", "==", month));
      const snap = await getDocs(qy);
      const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Deposit[];
      rows.sort((a: any, b: any) => getTime(a.date) - getTime(b.date));
      setDeposits(rows);
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  }

  async function onDeleteDeposit(id?: string) {
    if (!storeId || !id) return;
    if (!confirm("Delete this deposit?")) return;
    try {
      setErr(null);
      const user = me();
      await updateDoc(doc(db, "stores", storeId, "deposits", id), {
        deleted: true,
        deletedAt: Timestamp.now(),
        deletedByUid: user.uid,
        deletedByName: user.name,
        deletedByEmail: user.email,
      } as any);

      const qy = query(collection(db, "stores", storeId, "deposits"), where("month", "==", month));
      const snap = await getDocs(qy);
      const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Deposit[];
      rows.sort((a: any, b: any) => getTime(a.date) - getTime(b.date));
      setDeposits(rows);
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  }

  if (!storeId) return <main className="p-6">No store selected.</main>;

  // Compute opening for month m as either:
// 1) explicit override in /openingBalances/{m}, else
// 2) previous month's closing = prevOpen + cashIns(prev, not deleted) - entries(prev)
async function computeOpeningForMonth(storeId: string, m: string): Promise<number> {
  // 1) explicit override?
  const openSnap = await getDoc(doc(db, "stores", storeId, "openingBalances", m));
  if (openSnap.exists()) {
    return Number(((openSnap.data() as any).amount ?? 0));
  }

  // figure previous month key
  const [yy, mm] = m.split("-").map(Number);
  const prev = new Date(yy, (mm - 1) - 1, 1); // previous month
  const pm = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;

  // prev open (0 if never set)
  const prevOpenSnap = await getDoc(doc(db, "stores", storeId, "openingBalances", pm));
  const prevOpen = prevOpenSnap.exists()
    ? Number(((prevOpenSnap.data() as any).amount ?? 0))
    : 0;

  // sum cash-ins (skip soft-deleted)
  const cinSnap = await getDocs(
    query(collection(db, "stores", storeId, "cashins"), where("month", "==", pm))
  );
  let cin = 0;
  cinSnap.forEach(d => {
    const x = d.data() as any;
    if (x.deleted === true) return;
    cin += Number(x.amount || 0);
  });

// sum entries (cash-out) — ignore soft-deleted
const outSnap = await getDocs(
  query(collection(db, "stores", storeId, "entries"), where("month", "==", pm))
);
let out = 0;
outSnap.forEach((d) => {
  const x = d.data() as any;
  if (x.deleted === true) return;
  out += Number(x.amount || 0);
});


  return Number((prevOpen + cin - out).toFixed(2));
}


  // ── UI ────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen p-6 space-y-4 pb-24">
      <h1 className="text-2xl font-semibold mb-2 capitalize">{storeName} · Admin</h1>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-3 mb-4">
        <StatCard label="Entries (gross)" value={entriesSum} />
        <StatCard label="Cash in" value={cashInSum} />
        <StatCard label="Opening" value={opening} />
        <StatCard label="Projected closing" value={closing} danger={closing < 0} />
        <StatCard label="Deposits (tracker)" value={depositsSum} />
      </div>

      {/* Filters / Export controls */}
      <section className="rounded-lg border bg-white p-4">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 items-end">
          <div>
            <label className="block text-sm mb-1">Month</label>
            <MonthPicker value={month} onChange={setMonth} />
          </div>

          <div>
            <label className="block text-sm mb-1">Journal # (optional)</label>
            <input
              type="text"
              value={journalNo}
              onChange={(e) => setJournalNo(e.target.value)}
              className="border px-3 py-2 rounded w-full"
              placeholder="e.g., PC-20251012"
            />
          </div>

          <div>
            <label className="block text-sm mb-1">Cash-in credit account</label>
            <input
              type="text"
              value={cashInCreditAccount}
              onChange={(e) => setCashInCreditAccount(e.target.value)}
              className="border px-3 py-2 rounded w-full"
              disabled={!includeCashIns}
              placeholder="1000 Bank"
            />
          </div>

          <div className="flex gap-2 md:justify-end">
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
              className="border px-3 py-2 rounded"
              onClick={downloadCsvForMonthClient}
              title="Download the actual CSV"
            >
              Download CSV for {month}
            </button>
          </div>
        </div>
      </section>

      {/* dismissible error */}
      {err && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 flex items-start justify-between gap-4">
          <div>Error: {err}</div>
          <button className="underline" onClick={() => setErr(null)}>dismiss</button>
        </div>
      )}

      {/* Cash in */}
      <section className="rounded-lg border bg-white p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold">Cash in (refill)</h2>
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeCashIns}
              onChange={(e) => setIncludeCashIns(e.target.checked)}
            />
            Include cash-ins in QBO export
          </label>
        </div>

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
          <div className="mb-2 flex items-center gap-4 text-sm">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={showDeletedCashIns}
                onChange={(e) => setShowDeletedCashIns(e.target.checked)}
              />
              Show deleted
            </label>
          </div>
          <table className="min-w-[720px] text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2 pr-4">Date</th>
                <th className="py-2 pr-4">Amount</th>
                <th className="py-2 pr-4">Source</th>
                <th className="py-2 pr-4">Note</th>
                <th className="py-2 pr-4">By</th>
                <th className="py-2 pr-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {cashIns
                .filter((ci) => showDeletedCashIns || !ci.deleted)
                .map((ci) => {
                  const edited = !!ci.updatedAt && !ci.deleted;
                  const rowClass = ci.deleted ? "opacity-60 line-through" : edited ? "bg-yellow-50" : "";
                  const creator =
                    ci.createdByName || ci.createdByEmail || (ci.createdByUid ? `uid:${ci.createdByUid}` : "");
                  const editor =
                    ci.updatedByName || ci.updatedByEmail || (ci.updatedByUid ? `uid:${ci.updatedByUid}` : "");

                  if (editingCashIn?.id === ci.id) {
                    // Inline edit row
                    return (
                      <tr key={ci.id} className="border-b last:border-b-0">
                        <td className="py-2 pr-4">
                          <input
                            type="date"
                            className="border px-2 py-1 rounded"
                            defaultValue={isoDate(ci.date)}
                            onChange={(e) =>
                              setEditingCashIn((prev) =>
                                prev ? { ...prev, date: toTs(e.target.value) } : prev
                              )
                            }
                          />
                        </td>
                        <td className="py-2 pr-4">
                          <input
                            type="number"
                            step="0.01"
                            defaultValue={String(ci.amount)}
                            onChange={(e) =>
                              setEditingCashIn((prev) =>
                                prev ? { ...(prev as CashIn), amount: Number(e.target.value || 0) } : prev
                              )
                            }
                            className="border px-2 py-1 rounded w-28"
                          />
                        </td>
                        <td className="py-2 pr-4">
                          <input
                            defaultValue={ci.source || ""}
                            onChange={(e) =>
                              setEditingCashIn((prev) =>
                                prev ? { ...(prev as CashIn), source: e.target.value } : prev
                              )
                            }
                            className="border px-2 py-1 rounded"
                          />
                        </td>
                        <td className="py-2 pr-4">
                          <input
                            defaultValue={ci.note || ""}
                            onChange={(e) =>
                              setEditingCashIn((prev) =>
                                prev ? { ...(prev as CashIn), note: e.target.value } : prev
                              )
                            }
                            className="border px-2 py-1 rounded"
                          />
                        </td>
                        <td className="py-2 pr-4 text-xs">
                          <span title={`Created by ${creator}${editor ? ` • Last edited by ${editor}` : ""}`}>
                            edit…
                          </span>
                        </td>
                        <td className="py-2 pr-4 space-x-2">
                          <button className="underline" onClick={onEditCashInSave}>
                            Save
                          </button>
                          <button className="underline" onClick={() => setEditingCashIn(null)}>
                            Cancel
                          </button>
                        </td>
                      </tr>
                    );
                  }

                  // Normal (non-edit) row
                  return (
                    <tr key={ci.id} className={`border-b last:border-b-0 ${rowClass}`}>
                      <td className="py-2 pr-4">{fmtDate(ci.date)}</td>
                      <td className="py-2 pr-4">{Number(ci.amount || 0).toFixed(2)}</td>
                      <td className="py-2 pr-4">{ci.source ?? ""}</td>
                      <td className="py-2 pr-4">{ci.note ?? ""}</td>
                      <td className="py-2 pr-4 text-xs">
                        <span
                          className="inline-block rounded px-2 py-0.5 bg-gray-100"
                          title={`Created by ${creator}${editor ? ` • Last edited by ${editor}` : ""}`}
                        >
                          {creator || "—"}
                        </span>
                      </td>
                      <td className="py-2 pr-4 space-x-3">
                        {!ci.deleted && (
                          <>
                            <button className="underline" onClick={() => setEditingCashIn(ci)}>
                              Edit
                            </button>
                            <button className="underline text-red-700" onClick={() => onDeleteCashIn(ci.id)}>
                              Delete
                            </button>
                          </>
                        )}
                        {ci.deleted && <span className="text-xs">deleted</span>}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Deposits tracker */}
      <section className="rounded-lg border bg-white p-4">
        <h2 className="text-lg font-semibold mb-3">Deposits (tracker)</h2>
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
          <div className="mb-2 flex items-center gap-4 text-sm">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={showDeletedDeposits}
                onChange={(e) => setShowDeletedDeposits(e.target.checked)}
              />
              Show deleted
            </label>
          </div>
          <table className="min-w-[720px] text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2 pr-4">Date</th>
                <th className="py-2 pr-4">Amount</th>
                <th className="py-2 pr-4">Method</th>
                <th className="py-2 pr-4">Note</th>
                <th className="py-2 pr-4">By</th>
                <th className="py-2 pr-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {deposits
                .filter((d) => showDeletedDeposits || !d.deleted)
                .map((d) => {
                  const edited = !!d.updatedAt && !d.deleted;
                  const rowClass = d.deleted ? "opacity-60 line-through" : edited ? "bg-yellow-50" : "";
                  const creator =
                    d.createdByName || d.createdByEmail || (d.createdByUid ? `uid:${d.createdByUid}` : "");
                  const editor =
                    d.updatedByName || d.updatedByEmail || (d.updatedByUid ? `uid:${d.updatedByUid}` : "");

                  if (editingDeposit?.id === d.id) {
                    return (
                      <tr key={d.id} className="border-b last:border-b-0">
                        <td className="py-2 pr-4">
                          <input
                            type="date"
                            className="border px-2 py-1 rounded"
                            defaultValue={isoDate(d.date)}
                            onChange={(e) =>
                              setEditingDeposit((prev) =>
                                prev ? { ...prev, date: toTs(e.target.value) } : prev
                              )
                            }
                          />
                        </td>
                        <td className="py-2 pr-4">
                          <input
                            type="number"
                            step="0.01"
                            defaultValue={String(d.amount)}
                            onChange={(e) =>
                              setEditingDeposit((prev) =>
                                prev ? { ...prev, amount: Number(e.target.value || 0) } : prev
                              )
                            }
                            className="border px-2 py-1 rounded w-28"
                          />
                        </td>
                        <td className="py-2 pr-4">
                          <input
                            defaultValue={d.method || ""}
                            onChange={(e) =>
                              setEditingDeposit((prev) =>
                                prev ? { ...prev, method: e.target.value } : prev
                              )
                            }
                            className="border px-2 py-1 rounded"
                          />
                        </td>
                        <td className="py-2 pr-4">
                          <input
                            defaultValue={d.note || ""}
                            onChange={(e) =>
                              setEditingDeposit((prev) =>
                                prev ? { ...prev, note: e.target.value } : prev
                              )
                            }
                            className="border px-2 py-1 rounded"
                          />
                        </td>
                        <td className="py-2 pr-4 text-xs">
                          <span title={`Created by ${creator}${editor ? ` • Last edited by ${editor}` : ""}`}>
                            edit…
                          </span>
                        </td>
                        <td className="py-2 pr-4 space-x-2">
                          <button className="underline" onClick={onEditDepositSave}>
                            Save
                          </button>
                          <button className="underline" onClick={() => setEditingDeposit(null)}>
                            Cancel
                          </button>
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr key={d.id} className={`border-b last:border-b-0 ${rowClass}`}>
                      <td className="py-2 pr-4">{fmtDate(d.date)}</td>
                      <td className="py-2 pr-4">{Number(d.amount || 0).toFixed(2)}</td>
                      <td className="py-2 pr-4">{d.method ?? ""}</td>
                      <td className="py-2 pr-4">{d.note ?? ""}</td>
                      <td className="py-2 pr-4 text-xs">
                        <span
                          className="inline-block rounded px-2 py-0.5 bg-gray-100"
                          title={`Created by ${creator}${editor ? ` • Last edited by ${editor}` : ""}`}
                        >
                          {creator || "—"}
                        </span>
                      </td>
                      <td className="py-2 pr-4 space-x-3">
                        {!d.deleted && (
                          <>
                            <button className="underline" onClick={() => setEditingDeposit(d)}>
                              Edit
                            </button>
                            <button
                              className="underline text-red-700"
                              onClick={() => onDeleteDeposit(d.id)}
                            >
                              Delete
                            </button>
                          </>
                        )}
                        {d.deleted && <span className="text-xs">deleted</span>}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Audit & denominations (collapsible) */}
      <section className="rounded-lg border bg-white p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Petty cash audit &amp; denominations</h2>
          <button
            type="button"
            className="text-sm underline"
            onClick={() => setShowAudit(v => !v)}
            aria-expanded={showAudit}
          >
            {showAudit ? "Hide ▲" : "Tools ▾"}
          </button>
        </div>

        {showAudit && (
          <>
            <form onSubmit={onSaveAudit} className="mt-4 grid grid-cols-7 gap-3 max-w-5xl items-end">
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
                <input type="number" min="0" value={n5}  onChange={(e) => setN5(e.target.value)}  className="border px-3 py-2 rounded w-full" />
              </div>
              <div>
                <label className="block text-xs mb-1">$10 count</label>
                <input type="number" min="0" value={n10} onChange={(e) => setN10(e.target.value)} className="border px-3 py-2 rounded w-full" />
              </div>
              <div>
                <label className="block text-xs mb-1">$20 count</label>
                <input type="number" min="0" value={n20} onChange={(e) => setN20(e.target.value)} className="border px-3 py-2 rounded w-full" />
              </div>
              <div>
                <label className="block text-xs mb-1">$50 count</label>
                <input type="number" min="0" value={n50} onChange={(e) => setN50(e.target.value)} className="border px-3 py-2 rounded w-full" />
              </div>
              <div>
                <label className="block text-xs mb-1">$100 count</label>
                <input type="number" min="0" value={n100} onChange={(e) => setN100(e.target.value)} className="border px-3 py-2 rounded w-full" />
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
                  <strong>{variance >= 0 ? "+" : ""}${variance.toFixed(2)}</strong>
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
                    <th className="py-2 pr-4">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {audits
                    .filter(a => !a.deleted)
                    .slice(-5)
                    .map((a) => {
                      const dt = a.date?.toDate?.() ?? new Date();
                      const v = (Number(a.total || 0) - closing).toFixed(2);
                      return (
                        <tr key={a.id} className="border-b last:border-b-0">
                          <td className="py-2 pr-4">{dt.toLocaleDateString("en-CA")}</td>
                          <td className="py-2 pr-4">${Number(a.total || 0).toFixed(2)}</td>
                          <td className="py-2 pr-4">{v}</td>
                          <td className="py-2 pr-4">
                            <button
                              type="button"
                              className="text-red-600 hover:underline"
                              onClick={() => onDeleteAudit(a)}
                              title={
                                a.createdByName
                                  ? `Created by ${a.createdByName}${a.createdByEmail ? ` (${a.createdByEmail})` : ""}`
                                  : "Delete audit"
                              }
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    <div className="h-16 md:hidden" />
    <MobileNav storeId={String(storeId)} active="admin" />
    </main>
  );
}
