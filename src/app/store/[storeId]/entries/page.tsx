"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import {
  setDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  onSnapshot,
  Timestamp,
  where,
  updateDoc,
} from "firebase/firestore";
import { onAuthStateChanged, type User } from "firebase/auth";
import { round2, HST_RATE } from "@/lib/money";
import MonthPicker from "@/components/MonthPicker";
import MobileNav from "@/components/MobileNav";

type Account = { id: string; name?: string };
type EditState = {
  dateStr: string;
  vendor: string;
  description: string;
  receivedBy: string;
  amountStr: string;
  hstStr: string;
  accountId: string;
  dept: "FOH" | "BOH" | "TRAVEL" | "OTHER" | "BANK";
};

// Safer than inline <colgroup> with whitespace (prevents hydration warnings)
const JOURNAL_COL_WIDTHS = [
  "w-[110px]", // Date
  "w-[180px]", // Vendor
  "w-[240px]", // Description
  "w-[160px]", // Received By
  "w-[220px]", // Account
  "w-[90px]", // Dept
  "w-[90px]", // Invoice
  "w-[110px]", // Net
  "w-[110px]", // HST
  "w-[120px]", // Total
  "w-[140px]", // Actions
] as const;

export default function EntriesPage() {
  const { storeId } = useParams() as { storeId: string };
  const router = useRouter();
  const searchParams = useSearchParams();

  async function triggerInvoiceEmail(storeId: string, entryId: string) {
    try {
      const res = await fetch(`/api/store/${storeId}/notify-invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId }),
      });

      let data: any = null;
      try {
        data = await res.json();
      } catch {
        // response might not be JSON; that's fine
      }

      console.log("[triggerInvoiceEmail]", {
        storeId,
        entryId,
        status: res.status,
        data,
      });
    } catch (err) {
      // Don't block the UI if email fails; just log it.
      console.error("Failed to trigger invoice email:", err);
    }
  }

  // ===== Scanner state =====
  // invoiceUrlRaw: canonical Storage URL we save into Firestore
  // invoiceUrl:    cache-busted URL used in the form area
  // previewUrl:    used ONLY by the modal viewer (journal "View")
  const [invoiceUrlRaw, setInvoiceUrlRaw] = useState<string | null>(null);
  const [invoiceUrl, setInvoiceUrl] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // who/what we’re scanning for
  const [draftEntryId, setDraftEntryId] = useState<string | null>(null);
  const [showInvoice, setShowInvoice] = useState(false);

  // scanner-session bookkeeping
  const [scanNonce, setScanNonce] = useState<string>("");
  const [scanMode, setScanMode] = useState<"new" | "edit" | null>(null);
  const [scanningForId, setScanningForId] = useState<string | null>(null);

  function resetScanState() {
    setInvoiceUrlRaw(null);
    setInvoiceUrl(null);
    setPreviewUrl(null);
    setDraftEntryId(null);
    setScanNonce("");
    setScanMode(null);
    setScanningForId(null);
    try {
      localStorage.removeItem("pettycash:lastScan");
    } catch {}
  }
  // Clear only the latches (do NOT clear invoice url/draft id)
  function clearScanLatchOnly() {
    setScanNonce("");
    setScanMode(null);
    setScanningForId(null);
    try {
      localStorage.removeItem("pettycash:lastScan");
    } catch {}
  }

  // ===== Auth (for enteredBy) =====
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
    });
  }, []);

  const [role, setRole] = useState<"admin" | "manager" | "">("");
  const isAdmin = role === "admin";

  useEffect(() => {
    (async () => {
      if (!user?.uid) {
        setRole("");
        return;
      }
      const snap = await getDoc(doc(db, "memberships", user.uid));
      const data = snap.exists() ? (snap.data() as any) : null;
      setRole((data?.role as any) || "");
    })();
  }, [user?.uid]);

  // ===== Store name (optional) =====
  const [storeName, setStoreName] = useState<string | null>(null);
  useEffect(() => {
    if (!authReady || !user?.uid) return;
    (async () => {
      try {
        const s = await getDoc(doc(db, "stores", String(storeId)));
        if (s.exists()) setStoreName(((s.data() as any).name as string) || null);
        else setStoreName(null);
      } catch {
        setStoreName(null);
      }
    })();
  }, [authReady, user?.uid, storeId]);

  // ===== Accounts (map id -> name) =====
  const [accounts, setAccounts] = useState<Account[]>([]);
  const accountsMap = useMemo(
    () => new Map(accounts.map((a) => [a.id, a.name || a.id])),
    [accounts]
  );
  const [accLoading, setAccLoading] = useState(true);
  useEffect(() => {
    (async () => {
      setAccLoading(true);
      const snap = await getDocs(collection(db, "stores", String(storeId), "accounts"));
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        .filter((a) => a.id !== "1050 Petty Cash" && a.name !== "1050 Petty Cash")
        .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
      setAccounts(rows);
      setAccLoading(false);
    })();
  }, [storeId]);

  // ===== Month (URL param ?m=YYYY-MM) =====
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const urlMonth = searchParams.get("m") || todayStr.slice(0, 7);
  const [monthSel, setMonthSel] = useState<string>(urlMonth);
  useEffect(() => {
    if (urlMonth !== monthSel) setMonthSel(urlMonth);
  }, [urlMonth]);
  function setMonthAndUrl(m: string) {
    setMonthSel(m);
    const sp = new URLSearchParams(Array.from(searchParams.entries()));
    sp.set("m", m);
    router.replace(`?${sp.toString()}`, { scroll: false });
  }


  // ===== Month Lock (per YYYY-MM) =====
  const [monthIsLocked, setMonthIsLocked] = useState<boolean>(false);
  const [lockLoaded, setLockLoaded] = useState<boolean>(false);
  const [lockCache, setLockCache] = useState<Record<string, boolean>>({});

  const isManager = role === "manager";
  const managerWriteBlocked = isManager && monthIsLocked;

  useEffect(() => {
    if (!authReady || !user?.uid) return;
    if (!storeId || !monthSel) return;

    const ref = doc(db, "stores", String(storeId), "journalLocks", monthSel);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const locked = snap.exists() ? (snap.data() as any).locked === true : false;
        setMonthIsLocked(locked);
        setLockLoaded(true);
        setLockCache((prev) => ({ ...prev, [monthSel]: locked }));
      },
      () => {
        // If lock doc can't be read for any reason, default UI to unlocked.
        // Firestore rules still enforce the real lock.
        setMonthIsLocked(false);
        setLockLoaded(true);
      }
    );

    return () => unsub();
  }, [authReady, user?.uid, storeId, monthSel]);

  const lockMessage = (ym: string) =>
    "This month is locked. Please change the entry date or ask an administrator to unlock it.";

  async function getIsLocked(ym: string): Promise<boolean> {
    const key = (ym || "").trim();
    if (!key) return false;

    if (lockCache[key] !== undefined) return lockCache[key];

    try {
      const snap = await getDoc(doc(db, "stores", String(storeId), "journalLocks", key));
      const locked = snap.exists() ? (snap.data() as any).locked === true : false;
      setLockCache((prev) => ({ ...prev, [key]: locked }));
      return locked;
    } catch {
      return false;
    }
  }

  async function assertUnlocked(ym: string): Promise<boolean> {
    if (isAdmin) return true; // admins are never blocked
    const locked = await getIsLocked(ym);
    if (locked) {
      alert(lockMessage(ym));
      return false;
    }
    return true;
  }

  async function toggleMonthLock() {
    if (!isAdmin) return;
    if (!storeId || !monthSel) return;

    const nextLocked = !monthIsLocked;
    const ref = doc(db, "stores", String(storeId), "journalLocks", monthSel);

    if (nextLocked) {
      await setDoc(
        ref,
        {
          locked: true,
          lockedAt: serverTimestamp(),
          lockedByUid: user?.uid || null,
          lockedByName: (user?.displayName as any) || null,
          lockedByEmail: user?.email || null,
        },
        { merge: true }
      );
    } else {
      await setDoc(
        ref,
        {
          locked: false,
          updatedAt: serverTimestamp(),
          updatedByUid: user?.uid || null,
          updatedByName: (user?.displayName as any) || null,
          updatedByEmail: user?.email || null,
        },
        { merge: true }
      );
    }
  }


  // ===== Summary cards =====
  const [opening, setOpening] = useState<number>(0);
  const [cashIn, setCashIn] = useState<number>(0);
  const [cashOut, setCashOut] = useState<number>(0);
  const [hstTotal, setHstTotal] = useState<number>(0);
  const closing = useMemo(() => round2(opening + cashIn - cashOut), [opening, cashIn, cashOut]);
  const [summaryErr, setSummaryErr] = useState<string | null>(null);

  async function loadSummary(m: string) {
    try {
      setSummaryErr(null);
      setOpening(round2(await computeOpeningForMonth(String(storeId), m)));

      // cash-ins for the month (ignore soft-deleted; treat missing flag as not deleted)
      const cinSnap = await getDocs(
        query(collection(db, "stores", String(storeId), "cashins"), where("month", "==", m))
      );

      let cin = 0;
      cinSnap.forEach((d) => {
        const data = d.data() as any;
        if (data.deleted === true) return; // skip soft-deleted cash-ins
        cin += Number(data.amount || 0);
      });
      setCashIn(round2(cin));

      const outSnap = await getDocs(
        query(collection(db, "stores", String(storeId), "entries"), where("month", "==", m))
      );
      let out = 0,
        hstSum = 0;
      outSnap.forEach((d) => {
        const data = d.data() as any;
        if (data.deleted === true) return; // skip soft-deleted entries
        out += Number(data.amount || 0);
        hstSum += Number(data.hst || 0);
      });

      setCashOut(round2(out));
      setHstTotal(round2(hstSum));
    } catch (e: any) {
      setSummaryErr(e?.message || String(e));
    }
  }

  // ===== Journal (entries for selected month) =====
  const [journal, setJournal] = useState<any[]>([]);
  const [jLoading, setJLoading] = useState(true);
  const [journalErr, setJournalErr] = useState<string | null>(null);
  const [showDeletedEntries, setShowDeletedEntries] = useState(false);

  // Draft text for a note (only while editing)
  const [flagDrafts, setFlagDrafts] = useState<Record<string, string>>({});
  // Which entries are currently in "edit note" mode
  const [flagEditing, setFlagEditing] = useState<Record<string, boolean>>({});

  async function loadJournal(m: string) {
    setJLoading(true);
    try {
      setJournalErr(null);
      const qy = query(
        collection(db, "stores", String(storeId), "entries"),
        where("month", "==", m),
        orderBy("date", "asc")
      );
      const snap = await getDocs(qy);
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      setJournal(list);
    } catch (e: any) {
      setJournalErr(
        "Needs composite index: collection ‘entries’, fields month Asc + date Asc. Create in Firestore Console → Indexes → Composite."
      );
      setJournal([]);
    } finally {
      setJLoading(false);
    }
  }

  useEffect(() => {
    if (!authReady || !user?.uid) return;
    loadSummary(monthSel);
    loadJournal(monthSel);
  }, [authReady, user?.uid, storeId, monthSel]); // eslint-disable-line

  // ===== New-entry form =====
  const [dateStr, setDateStr] = useState(todayStr);
  const [vendor, setVendor] = useState("");
  const [description, setDescription] = useState("");
  const [receivedBy, setReceivedBy] = useState("");
  const [accountId, setAccountId] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [hstStr, setHstStr] = useState("");
  const [dept, setDept] = useState<"FOH" | "BOH" | "TRAVEL" | "OTHER" | "BANK">("FOH");

  // Pick first account after load
  useEffect(() => {
    if (!accLoading && accounts.length > 0 && !accountId) setAccountId(accounts[0].id);
  }, [accLoading, accounts, accountId]);

  const amountNum = parseFloat(amountStr || "0") || 0;
  const hstNum = parseFloat(hstStr || "0") || 0;
  const netNum = useMemo(() => round2(Math.max(amountNum - hstNum, 0)), [amountNum, hstNum]);

  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function monthString(d: Date) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  }
  function fillHst13() {
    setHstStr(amountNum ? round2(amountNum * HST_RATE).toFixed(2) : "");
  }

  // Live cash-ins total (ignores soft-deleted)
  useEffect(() => {
    if (!authReady || !user?.uid) return;
    if (!storeId) return;
    const qCashins = query(
      collection(db, "stores", String(storeId), "cashins"),
      where("month", "==", monthSel)
    );
    const unsub = onSnapshot(qCashins, (snap) => {
      let total = 0;
      snap.forEach((d) => {
        const data = d.data() as any;
        if (data.deleted === true) return; // skip soft-deleted
        total += Number(data.amount || 0);
      });
      setCashIn(round2(total));
    });
    return () => unsub();
  }, [authReady, user?.uid, storeId, monthSel]);

  // Live cash-out + HST totals
  useEffect(() => {
    if (!authReady || !user?.uid) return;
    if (!storeId) return;
    const qEntries = query(
      collection(db, "stores", String(storeId), "entries"),
      where("month", "==", monthSel)
    );
    const unsub = onSnapshot(qEntries, (snap) => {
      let out = 0,
        hstSum = 0;
      snap.forEach((d) => {
        const x = d.data() as any;
        if (x.deleted === true) return; // skip soft-deleted entries
        out += Number(x.amount || 0);
        hstSum += Number(x.hst || 0);
      });

      setCashOut(round2(out));
      setHstTotal(round2(hstSum));
    });
    return () => unsub();
  }, [authReady, user?.uid, storeId, monthSel]);

  // Live opening balance (override else computed from previous month)
  useEffect(() => {
    if (!authReady || !user?.uid) return;
    if (!storeId) return;
    const ref = doc(db, "stores", String(storeId), "openingBalances", monthSel);
    const unsub = onSnapshot(ref, async () => {
      const v = await computeOpeningForMonth(String(storeId), monthSel);
      setOpening(round2(v));
    });
    return () => unsub();
  }, [authReady, user?.uid, storeId, monthSel]);

  // Compute opening for month m as either:
  // 1) explicit override in /openingBalances/{m}, else
  // 2) previous month's closing = prevOpen + cashIns(prev, not deleted) - entries(prev, not deleted)
  async function computeOpeningForMonth(storeId: string, m: string): Promise<number> {
    // 1) explicit override?
    const openSnap = await getDoc(doc(db, "stores", storeId, "openingBalances", m));
    if (openSnap.exists()) {
      return Number((openSnap.data() as any).amount ?? 0);
    }

    // figure previous month key
    const [yy, mm] = m.split("-").map(Number);
    const prev = new Date(yy, mm - 2, 1); // previous month
    const pm = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;

    // prev open (0 if never set)
    const prevOpenSnap = await getDoc(doc(db, "stores", storeId, "openingBalances", pm));
    const prevOpen = prevOpenSnap.exists() ? Number((prevOpenSnap.data() as any).amount ?? 0) : 0;

    // sum cash-ins (skip soft-deleted)
    const cinSnap = await getDocs(
      query(collection(db, "stores", storeId, "cashins"), where("month", "==", pm))
    );
    let cin = 0;
    cinSnap.forEach((d) => {
      const x = d.data() as any;
      if (x.deleted === true) return;
      cin += Number(x.amount || 0);
    });

    // sum entries (cash-out) — SKIP soft-deleted here too
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

  // ------- Scanner integration -------
  function openScanner(mode: "new" | "edit", forId?: string) {
    if (!storeId) return;

    if (!isAdmin && monthIsLocked) {
      alert(lockMessage(monthSel));
      return;
    }
    // For a brand-new entry scan, clear only the form's attachment UI
    if (mode === "new") {
      setInvoiceUrl(null);
      setInvoiceUrlRaw(null);
      setPreviewUrl(null);
    }

    const entriesCol = collection(db, "stores", String(storeId), "entries");
    const useId = mode === "new" ? forId || draftEntryId || doc(entriesCol).id : (forId as string);

    if (mode === "new") setDraftEntryId(useId);

    setScanMode(mode);
    setScanningForId(useId);

    // One-time nonce ties the postMessage to THIS request only
    const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    setScanNonce(nonce);

    const params = new URLSearchParams({
      store: String(storeId),
      entry: useId,
      date: dateStr || new Date().toISOString().slice(0, 10),
      vendor: vendor || "",
      dept,
      category: accountsMap.get(accountId) || accountId || "Uncategorized",
      amount: amountStr || "0",
      nonce,
    });

    window.open(`/scanner-demo?${params.toString()}`, "pc-scan", "width=1200,height=900");
  }

  // Accept scan results (postMessage) with strict checks + consume localStorage once
  useEffect(() => {
    const acceptScan = async (d: any) => {
      if (!d || d.type !== "pc-scan-complete") return;

      // store + entry + nonce must match this page's intent
      if ((d.storeId || "").toLowerCase() !== String(storeId).toLowerCase()) return;
      if (scanningForId && d.entryId && d.entryId !== scanningForId) return;
      if (scanNonce && d.nonce && d.nonce !== scanNonce) return;

      const rawUrl: string = String(d.url || "");
      if (!rawUrl) return;
      const viewUrl = d.viewUrl || `${rawUrl}${rawUrl.includes("?") ? "&" : "?"}ts=${Date.now()}`;

      if (scanMode === "new") {
        // Attach ONLY to the Add-entry form (keep it until user hits Save)
        if (!draftEntryId && d.entryId) setDraftEntryId(d.entryId);
        setInvoiceUrlRaw(rawUrl);
        setInvoiceUrl(viewUrl);
        clearScanLatchOnly(); // do NOT wipe the attachment
      } else if (scanMode === "edit" && d.entryId) {
        // Overwrite the existing journal entry immediately
        await updateDoc(doc(db, "stores", String(storeId), "entries", d.entryId), {
          invoiceUrl: rawUrl,
          invoiceContentType: "application/pdf",
          updatedAt: serverTimestamp(),
        });

        // Trigger auto-email for this updated invoice (if the account is configured)
        triggerInvoiceEmail(String(storeId), d.entryId);

        await loadJournal(monthSel);
        setPreviewUrl(viewUrl);
        setShowInvoice(true);
        clearScanLatchOnly();
      }
    };

    function onMsg(ev: MessageEvent) {
      if (ev.origin !== window.location.origin) return;
      acceptScan(ev.data);
    }
    function onFocus() {
      try {
        const raw = localStorage.getItem("pettycash:lastScan");
        if (!raw) return;
        const d = JSON.parse(raw);
        acceptScan(d);
        localStorage.removeItem("pettycash:lastScan");
      } catch {}
    }

    window.addEventListener("message", onMsg);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("message", onMsg);
      window.removeEventListener("focus", onFocus);
    };
  }, [storeId, monthSel, scanNonce, scanMode, scanningForId, draftEntryId]);

  // ------- Create entry -------
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setErr(null);

    if (!user?.uid) {
      setErr("Please sign in again.");
      return;
    }

    if (!invoiceUrlRaw) {
      setErr("Please scan the invoice before saving.");
      return;
    }

    if (!dateStr || !vendor.trim() || !description.trim() || !receivedBy.trim() || !accountId || amountNum <= 0) {
      setErr("Please fill all fields.");
      return;
    }

    setSubmitting(true);
    try {
      const date = new Date(`${dateStr}T00:00:00`);
      const dateTs = Timestamp.fromDate(date);
      const month = monthString(date);

      if (!(await assertUnlocked(month))) return;

      const entriesCol = collection(db, "stores", String(storeId), "entries");
      const newRef = draftEntryId ? doc(entriesCol, draftEntryId) : doc(entriesCol);

      await setDoc(newRef, {
        date: dateTs,
        vendor: vendor.trim(),
        description: description.trim(),
        receivedBy: receivedBy.trim(),
        amount: round2(amountNum),
        hst: round2(hstNum),
        net: round2(Math.max(amountNum - hstNum, 0)),
        account: accountsMap.get(accountId) || accountId,
        accountName: accountsMap.get(accountId) || "",
        dept,
        month,
        createdAt: serverTimestamp(),
        enteredBy: {
          uid: user.uid,
          email: user.email || "",
          name: user.displayName || user.email || "",
        },
        invoiceUrl: invoiceUrlRaw, // canonical Storage URL
        invoiceContentType: "application/pdf",
      });

      // Trigger auto-email in the background (backend decides if it should send)
      triggerInvoiceEmail(String(storeId), newRef.id);

      // Reset form fields so the next entry starts clean
      setDateStr(todayStr);
      setVendor("");
      setDescription("");
      setReceivedBy("");
      setAccountId(accounts[0]?.id ?? "");
      setAmountStr("");
      setHstStr("");
      setDept("FOH");
      resetScanState(); // fully reset so the next entry starts clean
      setMsg("Entry saved.");
      await Promise.all([loadSummary(monthSel), loadJournal(monthSel)]);
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setSubmitting(false);
    }
  }

  // ===== Inline edit/delete =====
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);

  function beginEdit(r: any) {
    const d: Date = r.date?.toDate?.() || new Date(r.date);
    const dateIso = d.toISOString().slice(0, 10);
    setEditingId(r.id);
    setEdit({
      dateStr: dateIso,
      vendor: r.vendor || "",
      description: r.description || "",
      receivedBy: r.receivedBy || "",
      amountStr: String(r.amount ?? ""),
      hstStr: String(r.hst ?? ""),
      accountId: r.account || "",
      dept: (r.dept || "FOH") as EditState["dept"],
    });
  }
  function cancelEdit() {
    setEditingId(null);
    setEdit(null);
  }

  async function saveEdit() {
    if (!editingId || !edit) return;

    try {
      const u = auth.currentUser;
      if (!u?.uid) throw new Error("Not signed in");

      // Parse numbers once
      const amount = parseFloat(edit.amountStr || "0") || 0;
      const hst = parseFloat(edit.hstStr || "0") || 0;

      // Normalize date + month (same pattern as handleSubmit)
      const date = new Date(`${edit.dateStr}T00:00:00`);
      const dateTs = Timestamp.fromDate(date);
      const month = monthString(date);

      if (!(await assertUnlocked(month))) return;

      // Resolve account label
      const accountLabel = accountsMap.get(edit.accountId) || edit.accountId;

      const ref = doc(db, "stores", String(storeId), "entries", editingId);

      await updateDoc(ref, {
        date: dateTs,
        month,
        vendor: edit.vendor.trim(),
        description: edit.description.trim(),
        receivedBy: edit.receivedBy.trim(),
        amount: round2(amount),
        hst: round2(hst),
        net: round2(Math.max(amount - hst, 0)),
        account: accountLabel,
        accountName: accountLabel,
        dept: edit.dept,
        updatedAt: serverTimestamp(),
        updatedByUid: u.uid,
        updatedByEmail: u.email || "",
        updatedByName: u.displayName || u.email || "",
      } as any);

      setEditingId(null);
      setEdit(null);
      await Promise.all([loadSummary(monthSel), loadJournal(monthSel)]);
    } catch (e: any) {
      console.error("Edit failed", e);
      alert(`Update failed: ${e?.message || String(e)}`);
    }
  }

  async function deleteRow(id: string, ym?: string) {
    const month = ym || monthSel;
    if (!(await assertUnlocked(month))) return;

    if (!confirm("Delete this entry?")) return;
    try {
      const u = auth.currentUser;
      if (!u?.uid) throw new Error("Not signed in");

      await updateDoc(doc(db, "stores", String(storeId), "entries", id), {
        deleted: true,
        deletedAt: serverTimestamp(),
        deletedByUid: u.uid,
        deletedByName: u.displayName || u.email || "",
        deletedByEmail: u.email || "",
        updatedAt: serverTimestamp(),
        updatedByUid: u.uid,
        updatedByName: u.displayName || u.email || "",
        updatedByEmail: u.email || "",
      } as any);

      await Promise.all([loadSummary(monthSel), loadJournal(monthSel)]);
    } catch (e: any) {
      alert(`Delete failed: ${e?.message || e}`);
    }
  }

  // ===== Flag helpers (admin-only UI) =====
  function beginFlagNoteEdit(entryId: string, existing: string) {
    setFlagDrafts((p) => ({ ...p, [entryId]: existing ?? "" }));
    setFlagEditing((p) => ({ ...p, [entryId]: true }));
  }

  function cancelFlagNoteEdit(entryId: string) {
    setFlagEditing((p) => {
      const copy = { ...p };
      delete copy[entryId];
      return copy;
    });
    setFlagDrafts((p) => {
      const copy = { ...p };
      delete copy[entryId];
      return copy;
    });
  }

  async function toggleFlag(entryId: string, next: boolean, existingNote?: string) {
    if (!isAdmin) return;

    const u = auth.currentUser;
    if (!u?.uid) throw new Error("Not signed in");

    const ref = doc(db, "stores", String(storeId), "entries", entryId);

    if (next) {
      await updateDoc(ref, {
        flagged: true,
        flagNote: (existingNote ?? "").trim(),
        flaggedAt: serverTimestamp(),
        flaggedByUid: u.uid,
        flaggedByEmail: u.email || "",
        flaggedByName: u.displayName || u.email || "",
        updatedAt: serverTimestamp(),
        updatedByUid: u.uid,
        updatedByEmail: u.email || "",
        updatedByName: u.displayName || u.email || "",
      } as any);

      // Open the note editor right away so it feels intentional
      beginFlagNoteEdit(entryId, (existingNote ?? "").trim());
    } else {
      await updateDoc(ref, {
        flagged: false,
        flagNote: "",
        updatedAt: serverTimestamp(),
        updatedByUid: u.uid,
        updatedByEmail: u.email || "",
        updatedByName: u.displayName || u.email || "",
      } as any);

      // Clear local UI state for this entry
      cancelFlagNoteEdit(entryId);
    }

    await loadJournal(monthSel);
  }

  async function saveFlagNote(entryId: string) {
    if (!isAdmin) return;

    const u = auth.currentUser;
    if (!u?.uid) throw new Error("Not signed in");

    const note = (flagDrafts[entryId] ?? "").trim();
    const ref = doc(db, "stores", String(storeId), "entries", entryId);

    await updateDoc(ref, {
      flagNote: note,
      // Use existing allowed audit fields (keeps rules happy)
      updatedAt: serverTimestamp(),
      updatedByUid: u.uid,
      updatedByEmail: u.email || "",
      updatedByName: u.displayName || u.email || "",
    } as any);

    // Lock it down in the UI after save
    cancelFlagNoteEdit(entryId);

    await loadJournal(monthSel);
  }

  // ===== Vendor suggestions =====
  const recentVendors = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    journal.slice(0, 50).forEach((r: any) => {
      const v = (r?.vendor || "").trim();
      if (v && !seen.has(v)) {
        seen.add(v);
        out.push(v);
      }
    });
    return out.sort((a, b) => a.localeCompare(b, "en"));
  }, [journal]);

  // ===== UI =====
  return (
    <main className="p-6 space-y-4 pb-24 max-w-screen-xl mx-auto">
      {/* Header + month picker */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h1 className="text-2xl font-semibold mb-2 capitalize tracking-tight">
          {(storeName || storeId) + " · Entries"}
        </h1>

        <div className="flex items-center gap-3 flex-wrap justify-end">
          <label className="text-sm">Month</label>
          <MonthPicker value={monthSel} onChange={setMonthAndUrl} yearStart={2025} yearEnd={2035} />

          <span
            className={[
              "inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold",
              !lockLoaded
                ? "bg-gray-100 text-gray-700"
                : monthIsLocked
                ? "bg-red-100 text-red-800"
                : "bg-green-100 text-green-800",
            ].join(" ")}
            title="Managers cannot add/edit/delete entries while a month is locked."
          >
            {!lockLoaded ? "…" : monthIsLocked ? "LOCKED" : "UNLOCKED"}
          </span>

          {isAdmin && (
            <button
              type="button"
              className="text-xs underline"
              onClick={toggleMonthLock}
            >
              {monthIsLocked ? "Unlock month" : "Lock month"}
            </button>
          )}

          <div className="text-xs text-gray-600">HST helper: {Math.round(HST_RATE * 100)}%</div>
        </div>
      </div>

      {/* Summary cards */}
      <section className="grid gap-3 md:grid-cols-5">
        <div className="rounded-md border bg-white p-3">
          <div className="text-xs text-gray-500">Opening balance</div>
          <div className="text-lg font-semibold">${opening.toFixed(2)}</div>
        </div>
        <div className="rounded-md border bg-white p-3">
          <div className="text-xs text-gray-500">Cash out</div>
          <div className="text-lg font-semibold">${cashOut.toFixed(2)}</div>
        </div>
        <div className="rounded-md border bg-white p-3">
          <div className="text-xs text-gray-500">Cash in</div>
          <div className="text-lg font-semibold">${cashIn.toFixed(2)}</div>
        </div>
        <div className="rounded-md border bg-white p-3">
          <div className="text-xs text-gray-500">HST total</div>
          <div className="text-lg font-semibold">${hstTotal.toFixed(2)}</div>
        </div>
        <div className="rounded-md border bg-white p-3">
          <div className="text-xs text-gray-500">Closing balance</div>
          <div className="text-lg font-semibold">${closing.toFixed(2)}</div>
        </div>
      </section>
      {summaryErr && <p className="text-sm text-red-700">{summaryErr}</p>}

      {/* Add entry */}
      <form onSubmit={handleSubmit} className="rounded-xl border bg-white">
        <div className="p-4 border-b">
          <h2 className="text-lg font-medium">Add petty cash entry</h2>
        </div>

        {managerWriteBlocked && (
          <div className="p-4 border-b bg-red-50 text-red-800 text-sm">
            This month is locked. You can view it, but you can’t add or edit entries. Ask an admin to unlock the month.
          </div>
        )}

        {/* Fields grid */}
        <div className="p-4 grid gap-4 md:grid-cols-4">
          <div>
            <label className="block text-sm mb-1">Date</label>
            <input
              type="date"
              disabled={managerWriteBlocked}
              value={dateStr}
              onChange={(e) => setDateStr(e.target.value)}
              className="w-full rounded-md border px-3 py-2"
              required
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm mb-1">Vendor</label>
            <input
              value={vendor}
              disabled={managerWriteBlocked}
              onChange={(e) => setVendor(e.target.value)}
              placeholder="LCBO / Costco / …"
              className="w-full rounded-md border px-3 py-2"
              list="recent-vendors"
              required
            />
            <datalist id="recent-vendors">
              {recentVendors.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </div>

          <div>
            <label className="block text-sm mb-1">Account</label>
            <select
              disabled={managerWriteBlocked}
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="w-full rounded-md border px-3 py-2 bg-white"
              disabled={accLoading || accounts.length === 0}
              required
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name || a.id}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-3">
            <label className="block text-sm mb-1">Description of order</label>
            <input
              value={description}
              disabled={managerWriteBlocked}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Paper towels, wine, detergent…"
              className="w-full rounded-md border px-3 py-2"
              required
            />
          </div>

          <div>
            <label className="block text-sm mb-1">$ Received By</label>
            <input
              value={receivedBy}
              disabled={managerWriteBlocked}
              onChange={(e) => setReceivedBy(e.target.value)}
              placeholder="Name"
              className="w-full rounded-md border px-3 py-2"
              required
            />
          </div>

          <div>
            <label className="block text-sm mb-1">Amount (total)</label>
            <input
              inputMode="decimal"
              value={amountStr}
              disabled={managerWriteBlocked}
              onChange={(e) => setAmountStr(e.target.value)}
              placeholder="148.00"
              className="w-full rounded-md border px-3 py-2"
              required
            />
          </div>

          <div>
            <label className="block text-sm mb-1 flex items-center gap-2">
              HST (optional)
              <button type="button" className="underline text-xs" onClick={fillHst13} title="13% of amount">
                13%
              </button>
              <button type="button" className="underline text-xs" onClick={() => setHstStr("")} title="Clear HST">
                clear
              </button>
            </label>
            <input
              inputMode="decimal"
              value={hstStr}
              disabled={managerWriteBlocked}
              onChange={(e) => setHstStr(e.target.value)}
              placeholder="0.00"
              className="w-full rounded-md border px-3 py-2"
            />
          </div>

          <div>
            <label className="block text-sm mb-1">Net (auto)</label>
            <input value={netNum.toFixed(2)} readOnly className="w-full rounded-md border px-3 py-2 bg-gray-50" />
          </div>

          <div>
            <label className="block text-sm mb-1">Department</label>
            <select
              disabled={managerWriteBlocked}
              value={dept}
              onChange={(e) => setDept(e.target.value as any)}
              className="w-full rounded-md border px-3 py-2 bg-white"
            >
              <option value="FOH">FOH</option>
              <option value="BOH">BOH</option>
              <option value="TRAVEL">TRAVEL</option>
              <option value="OTHER">OTHER</option>
              <option value="BANK">Bank Deposit</option>
            </select>
          </div>
        </div>

        {/* Invoice (required) */}
        <div className="p-4 border-t">
          <label className="block text-sm font-medium mb-1">Invoice (required)</label>
          <div className="flex items-center gap-3">
            <button type="button" className="px-3 py-2 border rounded" onClick={() => openScanner("new")}>
              {invoiceUrl ? "Re-scan Invoice" : "Scan Invoice"}
            </button>

            {invoiceUrl ? (
              <>
                <button
                  type="button"
                  className="px-3 py-2 border rounded"
                  onClick={() => {
                    setPreviewUrl(invoiceUrl);
                    setScanMode("new");
                    setScanningForId(null);
                    setShowInvoice(true);
                  }}
                >
                  View invoice
                </button>
                <span className="text-xs text-green-700">Attached</span>
              </>
            ) : (
              <span className="text-xs text-red-600">Required</span>
            )}
          </div>
        </div>

        <div className="p-4 border-t flex items-center gap-3">
          <button
            type="submit"
            disabled={submitting || accounts.length === 0}
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          >
            {submitting ? "Saving…" : "Save entry"}
          </button>
          {msg && <span className="text-green-700 text-sm">{msg}</span>}
          {err && <span className="text-red-700 text-sm">Error: {err}</span>}
        </div>
      </form>

      {/* Invoice Viewer Modal */}
      {showInvoice && (previewUrl || invoiceUrl) && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
          <div className="bg-white rounded-xl shadow-xl w-[92vw] max-w-screen-xl h-[88vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b shrink-0">
              <div className="text-sm font-medium truncate">Invoice preview</div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="px-3 py-1.5 border rounded"
                  onClick={() => {
                    setShowInvoice(false);
                    try {
                      localStorage.removeItem("pettycash:lastScan");
                    } catch {}

                    if (scanMode === "edit" && scanningForId) {
                      openScanner("edit", scanningForId);
                    } else {
                      setInvoiceUrl(null);
                      setInvoiceUrlRaw(null);
                      setPreviewUrl(null);
                      openScanner("new", draftEntryId || undefined);
                    }
                  }}
                >
                  Re-scan
                </button>

                <button type="button" className="px-3 py-1.5 border rounded" onClick={() => setShowInvoice(false)}>
                  Close
                </button>
              </div>
            </div>
            <iframe title="Invoice PDF" src={`${(previewUrl || invoiceUrl)!}#zoom=50`} className="w-full grow" />
          </div>
        </div>
      )}

      {/* Journal */}
      <section className="rounded-xl border bg-white">
        <div className="p-4 border-b">
          <h2 className="text-lg font-medium">Journal — {monthSel}</h2>
        </div>

        <div className="p-4">
          <div className="mb-2">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showDeletedEntries}
                onChange={(e) => setShowDeletedEntries(e.target.checked)}
              />
              Show deleted
            </label>
          </div>

          <div className="overflow-x-auto">
            {jLoading ? (
              <div className="text-sm text-gray-600">Loading…</div>
            ) : journalErr ? (
              <div className="text-sm text-red-700">{journalErr}</div>
            ) : journal.filter((r) => showDeletedEntries || r.deleted !== true).length === 0 ? (
              <div className="text-sm text-gray-600">No entries this month.</div>
            ) : (
              <table className="min-w-[1300px] table-fixed text-sm w-full">
                <colgroup>
                  {JOURNAL_COL_WIDTHS.map((cls, i) => (
                    <col key={i} className={cls} />
                  ))}
                </colgroup>

                <thead>
                  <tr className="text-left text-gray-600">
                    <th className="py-2 pr-4">Date</th>
                    <th className="py-2 pr-4">Vendor</th>
                    <th className="py-2 pr-4">Description</th>
                    <th className="py-2 pr-4">$ Received By</th>
                    <th className="py-2 pr-4">Account</th>
                    <th className="py-2 pr-4">Dept</th>
                    <th className="py-2 pr-4">Invoice</th>
                    <th className="py-2 pr-4 text-right">Net</th>
                    <th className="py-2 pr-4 text-right">HST</th>
                    <th className="py-2 pr-4 text-right">Total</th>
                    <th className="py-2 pr-4"></th>
                  </tr>
                </thead>

                <tbody>
                  {journal
                    .filter((r) => showDeletedEntries || r.deleted !== true)
                    .map((r) => {
                      const d: Date = r.date?.toDate?.() || new Date(r.date);
                      const dStr = d.toISOString().slice(0, 10);
                      const accountLabel = r.accountName || accountsMap.get(r.account) || r.account;

                      // ----- EDITING ROW -----
                      if (editingId === r.id && edit) {
                        return (
                          <tr
                            key={r.id}
                            className={`border-t align-top ${r.flagged ? "text-red-700" : ""} ${
                              showDeletedEntries && r.deleted ? "opacity-60 line-through" : ""
                            }`}
                          >
                            <td className="py-2 pr-4">
                              <input
                                type="date"
                                value={edit.dateStr}
                                onChange={(e) => setEdit({ ...edit, dateStr: e.target.value })}
                                className="w-full rounded border px-2 py-1"
                              />
                            </td>
                            <td className="py-2 pr-4">
                              <input
                                value={edit.vendor}
                                onChange={(e) => setEdit({ ...edit, vendor: e.target.value })}
                                className="w-full rounded border px-2 py-1"
                              />
                            </td>
                            <td className="py-2 pr-4">
                              <input
                                value={edit.description}
                                onChange={(e) => setEdit({ ...edit, description: e.target.value })}
                                className="w-full rounded border px-2 py-1"
                              />
                            </td>
                            <td className="py-2 pr-4">
                              <input
                                value={edit.receivedBy}
                                onChange={(e) => setEdit({ ...edit, receivedBy: e.target.value })}
                                className="w-full rounded border px-2 py-1"
                              />
                            </td>
                            <td className="py-2 pr-4">
                              <select
                                value={edit.accountId}
                                onChange={(e) => setEdit({ ...edit, accountId: e.target.value })}
                                className="w-full rounded border px-2 py-1 bg-white"
                              >
                                {accounts.map((a) => (
                                  <option key={a.id} value={a.id}>
                                    {a.name || a.id}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="py-2 pr-4">
                              <select
                                value={edit.dept}
                                onChange={(e) => setEdit({ ...edit, dept: e.target.value as any })}
                                className="w-full rounded border px-2 py-1 bg-white"
                              >
                                <option value="FOH">FOH</option>
                                <option value="BOH">BOH</option>
                                <option value="TRAVEL">TRAVEL</option>
                                <option value="OTHER">OTHER</option>
                                <option value="BANK">Bank Deposit</option>
                              </select>
                            </td>
                            <td className="py-2 pr-4">
                              {r.invoiceUrl ? (
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    className="underline"
                                    onClick={() => {
                                      setPreviewUrl(
                                        `${r.invoiceUrl}${r.invoiceUrl.includes("?") ? "&" : "?"}ts=${Date.now()}`
                                      );
                                      setScanMode("edit");
                                      setScanningForId(r.id);
                                      setShowInvoice(true);
                                    }}
                                  >
                                    View
                                  </button>
                                </div>
                              ) : (
                                <span className="text-xs text-gray-400">—</span>
                              )}
                            </td>
                            <td className="py-2 pr-4 text-right">
                              <input
                                inputMode="decimal"
                                value={
                                  edit.amountStr
                                    ? (
                                        Math.max(
                                          (parseFloat(edit.amountStr || "0") || 0) -
                                            (parseFloat(edit.hstStr || "0") || 0),
                                          0
                                        ) || 0
                                      ).toFixed(2)
                                    : "0.00"
                                }
                                readOnly
                                className="w-full rounded border px-2 py-1 bg-gray-50 text-right"
                              />
                            </td>
                            <td className="py-2 pr-4 text-right">
                              <input
                                inputMode="decimal"
                                value={edit.hstStr}
                                onChange={(e) => setEdit({ ...edit, hstStr: e.target.value })}
                                className="w-full rounded border px-2 py-1 text-right"
                              />
                            </td>
                            <td className="py-2 pr-4 text-right">
                              <input
                                inputMode="decimal"
                                value={edit.amountStr}
                                onChange={(e) => setEdit({ ...edit, amountStr: e.target.value })}
                                className="w-full rounded border px-2 py-1 text-right"
                              />
                            </td>
                            <td className="py-2 pr-4">
                              <div className="flex gap-2">
                                <button
                                  className={
                                    managerWriteBlocked
                                      ? "underline opacity-50 cursor-not-allowed"
                                      : "underline"
                                  }
                                  onClick={saveEdit}
                                  type="button"
                                >
                                  Save
                                </button>
                                <button className="underline" onClick={cancelEdit} type="button">
                                  Cancel
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      }

                      // ----- NORMAL ROW + OPTIONAL FLAG NOTE ROW -----
                      const noteIsEditing = !!flagEditing[r.id];
                      const lockedNote = (r.flagNote ?? "").trim();
                      const draftVal = flagDrafts[r.id] ?? r.flagNote ?? "";

                      return (
                        <Fragment key={r.id}>
                          <tr
                            className={`border-t align-top ${r.flagged ? "text-red-700" : ""} ${
                              showDeletedEntries && r.deleted ? "opacity-60 line-through" : ""
                            }`}
                          >
                            <td className="py-2 pr-4 whitespace-nowrap">{dStr}</td>
                            <td className="py-2 pr-4 truncate">{r.vendor}</td>
                            <td className="py-2 pr-4 truncate">{r.description}</td>
                            <td className="py-2 pr-4 truncate">{r.receivedBy || "—"}</td>
                            <td className="py-2 pr-4 truncate">{accountLabel}</td>
                            <td className="py-2 pr-4 whitespace-nowrap">{r.dept || ""}</td>
                            <td className="py-2 pr-4">
                              {r.invoiceUrl ? (
                                <button
                                  type="button"
                                  className="underline"
                                  onClick={() => {
                                    setPreviewUrl(
                                      `${r.invoiceUrl}${r.invoiceUrl.includes("?") ? "&" : "?"}ts=${Date.now()}`
                                    );
                                    setScanMode("edit");
                                    setScanningForId(r.id);
                                    setShowInvoice(true);
                                  }}
                                >
                                  View
                                </button>
                              ) : (
                                <span className="text-xs text-gray-500">—</span>
                              )}
                            </td>
                            <td className="py-2 pr-4 text-right whitespace-nowrap">${Number(r.net).toFixed(2)}</td>
                            <td className="py-2 pr-4 text-right whitespace-nowrap">${Number(r.hst).toFixed(2)}</td>
                            <td className="py-2 pr-4 text-right whitespace-nowrap">${Number(r.amount).toFixed(2)}</td>
                            <td className="py-2 pr-4">
                              <div className="flex gap-3">
                                <button
                      className={
                        managerWriteBlocked ? "underline opacity-50 cursor-not-allowed" : "underline"
                      }
                      onClick={() => beginEdit(r)}
                      type="button"
                    >
                                  Edit
                                </button>
                                <button
                      className={
                        managerWriteBlocked ? "underline opacity-50 cursor-not-allowed" : "underline"
                      }
                      onClick={() => deleteRow(r.id, r.month)}
                      type="button"
                    >
                                  Delete
                                </button>

                                {isAdmin && (
                                  <button
                                    className="underline"
                                    onClick={() => toggleFlag(r.id, !r.flagged, r.flagNote ?? "")}
                                    type="button"
                                  >
                                    {r.flagged ? "Unflag" : "Flag"}
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>

                          {isAdmin && r.flagged && (
                            <tr className="border-t bg-red-50">
                              <td className="py-3 px-4" colSpan={11}>
                                <div className="flex flex-col gap-2">
                                  <label className="text-sm font-medium text-red-700">Flag note (admin only)</label>

                                  {/* LOCKED VIEW */}
                                  {!noteIsEditing ? (
                                    <div className="flex flex-col gap-2">
                                      {lockedNote ? (
                                        <div className="rounded border bg-white px-3 py-2 text-sm whitespace-pre-wrap">
                                          {lockedNote}
                                        </div>
                                      ) : (
                                        <div className="text-sm text-gray-600 italic">No note saved.</div>
                                      )}

                                      <div className="flex items-center gap-2">
                                        <button
                                          type="button"
                                          className="border px-3 py-1 rounded text-sm bg-white"
                                          onClick={() => beginFlagNoteEdit(r.id, r.flagNote ?? "")}
                                        >
                                          {lockedNote ? "Edit note" : "Add note"}
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    /* EDIT MODE */
                                    <div className="flex flex-col gap-2">
                                      <textarea
                                        value={draftVal}
                                        onChange={(e) => setFlagDrafts((p) => ({ ...p, [r.id]: e.target.value }))}
                                        className="w-full rounded border px-3 py-2 text-sm"
                                        rows={3}
                                        placeholder="Optional note…"
                                      />
                                      <div className="flex items-center gap-2">
                                        <button
                                          type="button"
                                          className="border px-3 py-1 rounded text-sm bg-white"
                                          onClick={() => saveFlagNote(r.id)}
                                        >
                                          Save note
                                        </button>
                                        <button
                                          type="button"
                                          className="underline text-sm"
                                          onClick={() => cancelFlagNoteEdit(r.id)}
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </section>

      {/* --- Export tools --------------------------------------------------- */}
      <section className="rounded-lg border bg-white p-4 mt-6">
        <h3 className="font-semibold mb-3">Exports</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {/* Excel journal (no images) */}
          <button
            type="button"
            className="border px-3 py-2 rounded"
            onClick={() => {
              try {
                localStorage.setItem("pc_download_active", "1");
                setTimeout(() => {
                  try {
                    localStorage.removeItem("pc_download_active");
                  } catch {}
                }, 15000);
              } catch {}

              window.open(`/api/store/${storeId}/journal-xlsx?m=${monthSel}`, "_blank", "noopener,noreferrer");
            }}
          >
            Download Journal (Excel) — {monthSel}
          </button>

          {/* Invoices ZIP */}
          <button
            type="button"
            className="border px-3 py-2 rounded"
            onClick={() => {
              try {
                localStorage.setItem("pc_download_active", "1");
                setTimeout(() => {
                  try {
                    localStorage.removeItem("pc_download_active");
                  } catch {}
                }, 15000);
              } catch {}

              window.open(`/api/store/${storeId}/invoices-zip?m=${monthSel}`, "_blank", "noopener,noreferrer");
            }}
          >
            Download All Invoices (ZIP) — {monthSel}
          </button>
        </div>
        <p className="text-xs text-gray-600 mt-2">Need a custom date range? Use Admin → QBO Export (date-range export).</p>
      </section>

      <div className="h-16 md:hidden" />
      <MobileNav storeId={String(storeId)} active="entries" />
    </main>
  );
}