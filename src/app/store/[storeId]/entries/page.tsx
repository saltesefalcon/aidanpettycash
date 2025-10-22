"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import {
  addDoc, collection, doc, getDoc, getDocs, limit, orderBy, query,
  serverTimestamp, Timestamp, where
} from "firebase/firestore";
import { onAuthStateChanged, type User } from "firebase/auth";
import { round2, HST_RATE } from "@/lib/money";
import MonthPicker from "@/components/MonthPicker";

type Account = { id: string; name?: string };
type EditState = {
  dateStr: string;
  vendor: string;
  description: string;
  amountStr: string;
  hstStr: string;
  accountId: string;
  dept: "FOH" | "BOH" | "TRAVEL" | "OTHER" | "BANK";
};

export default function EntriesPage() {
  const { storeId } = useParams<{ storeId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();

  // ===== Auth (for enteredBy) =====
  const [user, setUser] = useState<User | null>(auth.currentUser);
  useEffect(() => onAuthStateChanged(auth, setUser), []);

  // ===== Store name (optional) =====
  const [storeName, setStoreName] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      const s = await getDoc(doc(db, "stores", String(storeId)));
      if (s.exists()) setStoreName(((s.data() as any).name as string) || null);
    })();
  }, [storeId]);

  // ===== Accounts (map id -> name) =====
  const [accounts, setAccounts] = useState<Account[]>([]);
  const accountsMap = useMemo(
    () => new Map(accounts.map(a => [a.id, a.name || a.id])),
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
  // keep state in sync with the URL if it changes
  useEffect(() => { if (urlMonth !== monthSel) setMonthSel(urlMonth); }, [urlMonth]); // eslint-disable-line

  function setMonthAndUrl(m: string) {
    setMonthSel(m);
    const sp = new URLSearchParams(Array.from(searchParams.entries()));
    sp.set("m", m);
    router.replace(`?${sp.toString()}`, { scroll: false });
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
      const openSnap = await getDoc(doc(db, "stores", String(storeId), "openingBalances", m));
      setOpening(openSnap.exists() ? Number((openSnap.data() as any).amount || 0) : 0);

      const cinSnap = await getDocs(
        query(collection(db, "stores", String(storeId), "cashins"), where("month", "==", m))
      );
      let cin = 0;
      cinSnap.forEach((d) => { cin += Number((d.data() as any).amount || 0); });
      setCashIn(round2(cin));

      const outSnap = await getDocs(
        query(collection(db, "stores", String(storeId), "entries"), where("month", "==", m))
      );
      let out = 0, hstSum = 0;
      outSnap.forEach((d) => {
        const data = d.data() as any;
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

  async function loadJournal(m: string) {
    setJLoading(true);
    try {
      setJournalErr(null);
      const qy = query(
        collection(db, "stores", String(storeId), "entries"),
        where("month", "==", m),
        orderBy("date", "asc") // if this triggers an index error, remove orderBy OR create composite index (month asc, date asc)
      );
      const snap = await getDocs(qy);
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      setJournal(list);
    } catch (e: any) {
      // Likely missing index or still building.
      setJournalErr(
        "Needs composite index: collection ‘entries’, fields month Asc + date Asc. Create in Firestore Console → Indexes → Composite."
      );
      setJournal([]);
    } finally {
      setJLoading(false);
    }
  }

  useEffect(() => { loadSummary(monthSel); loadJournal(monthSel); }, [storeId, monthSel]); // eslint-disable-line

  // ===== New-entry form =====
  const [dateStr, setDateStr] = useState(todayStr);
  const [vendor, setVendor] = useState("");
  const [description, setDescription] = useState("");
  const [accountId, setAccountId] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [hstStr, setHstStr] = useState("");
  const [dept, setDept] = useState<"FOH"|"BOH"|"TRAVEL"|"OTHER"|"BANK">("FOH");

  const amountNum = parseFloat(amountStr || "0") || 0;
  const hstNum    = parseFloat(hstStr || "0") || 0;
  const netNum    = useMemo(() => round2(Math.max(amountNum - hstNum, 0)), [amountNum, hstNum]);

  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function monthString(d: Date) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  }
  function fillHst13() {
    setHstStr(amountNum ? (round2(amountNum * HST_RATE)).toFixed(2) : "");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null); setErr(null);

    if (!dateStr || !vendor.trim() || !description.trim() || !accountId || amountNum <= 0) {
      setErr("Please fill all fields.");
      return;
    }

    setSubmitting(true);
    try {
      const date = new Date(`${dateStr}T00:00:00`);
      const dateTs = Timestamp.fromDate(date);
      const month = monthString(date);

      await addDoc(collection(db, "stores", String(storeId), "entries"), {
        date: dateTs,
        vendor: vendor.trim(),
        description: description.trim(),
        amount: round2(amountNum),
        hst: round2(hstNum),
        net: round2(Math.max(amountNum - hstNum, 0)),
        account: accountId,                             // keep id
        accountName: accountsMap.get(accountId) || "",  // save readable name
        dept,
        month,
        createdAt: serverTimestamp(),
        enteredBy: {
          uid: user?.uid || null,
          email: user?.email || null,
          name: user?.displayName || null,
        },
      });

      setMsg("Entry saved.");
      setVendor(""); setDescription(""); setAmountStr(""); setHstStr("");
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
      amountStr: String(r.amount ?? ""),
      hstStr: String(r.hst ?? ""),
      accountId: r.account || "",
      dept: (r.dept || "FOH") as EditState["dept"],
    });
  }
  function cancelEdit() { setEditingId(null); setEdit(null); }

  async function saveEdit() {
    if (!editingId || !edit) return;
    const payload = {
      date: edit.dateStr,
      vendor: edit.vendor.trim(),
      description: edit.description.trim(),
      amount: parseFloat(edit.amountStr || "0") || 0,
      hst: parseFloat(edit.hstStr || "0") || 0,
      accountId: edit.accountId,
      accountName: accountsMap.get(edit.accountId) || "",
      dept: edit.dept,
    };
    const res = await fetch(`/api/stores/${storeId}/entries/${editingId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      alert(`Update failed (${res.status}): ${await res.text()}`);
      return;
    }
    setEditingId(null); setEdit(null);
    await Promise.all([loadSummary(monthSel), loadJournal(monthSel)]);
  }

  async function deleteRow(id: string) {
    if (!confirm("Delete this entry?")) return;
    const res = await fetch(`/api/stores/${storeId}/entries/${id}`, { method: "DELETE" });
    if (!res.ok) {
      alert(`Delete failed (${res.status}): ${await res.text()}`);
      return;
    }
    await Promise.all([loadSummary(monthSel), loadJournal(monthSel)]);
  }

  // ===== Vendor suggestions (NEW) =====
  const recentVendors = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    journal.slice(0, 50).forEach((r: any) => {
      const v = (r?.vendor || "").trim();
      if (v && !seen.has(v)) { seen.add(v); out.push(v); }
    });
    return out.sort((a, b) => a.localeCompare(b, "en"));
  }, [journal]);

  // ===== UI =====
  return (
    <main className="p-6 space-y-6">
      {/* Header + month picker (writes to URL) */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h1 className="text-2xl font-semibold mb-2 capitalize tracking-tight">
          {(storeName || storeId) + " · Entries"}
        </h1>
        <div className="flex items-center gap-3">
          <label className="text-sm">Month</label>
          <MonthPicker value={monthSel} onChange={setMonthAndUrl} yearStart={2025} yearEnd={2035} />
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

        <div className="p-4 grid gap-4 md:grid-cols-4">
          <div>
            <label className="block text-sm mb-1">Date</label>
            <input
              type="date"
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
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="w-full rounded-md border px-3 py-2 bg-white"
              disabled={accLoading || accounts.length === 0}
              required
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name || a.id}</option>
              ))}
            </select>
          </div>

          <div className="md:col-span-4">
            <label className="block text-sm mb-1">Description of order</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Paper towels, wine, detergent…"
              className="w-full rounded-md border px-3 py-2"
              required
            />
          </div>

          <div>
            <label className="block text-sm mb-1">Amount (total)</label>
            <input
              inputMode="decimal"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              placeholder="148.00"
              className="w-full rounded-md border px-3 py-2"
              required
            />
          </div>

          <div>
            <label className="block text-sm mb-1 flex items-center gap-2">
              HST (optional)
              <button type="button" className="underline text-xs" onClick={fillHst13} title="13% of amount">13%</button>
              <button type="button" className="underline text-xs" onClick={() => setHstStr("")} title="Clear HST">clear</button>
            </label>
            <input
              inputMode="decimal"
              value={hstStr}
              onChange={(e) => setHstStr(e.target.value)}
              placeholder="0.00"
              className="w-full rounded-md border px-3 py-2"
            />
          </div>

          <div>
            <label className="block text-sm mb-1">Net (auto)</label>
            <input
              value={netNum.toFixed(2)}
              readOnly
              className="w-full rounded-md border px-3 py-2 bg-gray-50"
            />
          </div>

          <div>
            <label className="block text-sm mb-1">Department</label>
            <select
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

      {/* Journal for selected month */}
      <section className="rounded-xl border bg-white">
        <div className="p-4 border-b">
          <h2 className="text-lg font-medium">Journal — {monthSel}</h2>
        </div>
        <div className="p-4 overflow-x-auto">
          {jLoading ? (
            <div className="text-sm text-gray-600">Loading…</div>
          ) : journalErr ? (
            <div className="text-sm text-red-700">{journalErr}</div>
          ) : journal.length === 0 ? (
            <div className="text-sm text-gray-600">No entries this month.</div>
          ) : (
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-600">
                  <th className="py-2 pr-4">Date</th>
                  <th className="py-2 pr-4">Vendor</th>
                  <th className="py-2 pr-4">Description</th>
                  <th className="py-2 pr-4">Account</th>
                  <th className="py-2 pr-4">Dept</th>
                  <th className="py-2 pr-4 text-right">Net</th>
                  <th className="py-2 pr-4 text-right">HST</th>
                  <th className="py-2 pr-4 text-right">Total</th>
                  <th className="py-2 pr-4"></th>
                </tr>
              </thead>
              <tbody>
                {journal.map((r) => {
                  const d: Date = r.date?.toDate?.() || new Date(r.date);
                  const dStr = d.toISOString().slice(0, 10);
                  const accountLabel = r.accountName || accountsMap.get(r.account) || r.account;

                  if (editingId === r.id && edit) {
                    return (
                      <tr key={r.id} className="border-t align-top">
                        <td className="py-2 pr-4">
                          <input type="date" value={edit.dateStr} onChange={(e)=>setEdit({...edit, dateStr:e.target.value})} className="rounded border px-2 py-1" />
                        </td>
                        <td className="py-2 pr-4">
                          <input value={edit.vendor} onChange={(e)=>setEdit({...edit, vendor:e.target.value})} className="rounded border px-2 py-1" />
                        </td>
                        <td className="py-2 pr-4">
                          <input value={edit.description} onChange={(e)=>setEdit({...edit, description:e.target.value})} className="rounded border px-2 py-1" />
                        </td>
                        <td className="py-2 pr-4">
                          <select value={edit.accountId} onChange={(e)=>setEdit({...edit, accountId:e.target.value})} className="rounded border px-2 py-1 bg-white">
                            {accounts.map(a => <option key={a.id} value={a.id}>{a.name || a.id}</option>)}
                          </select>
                        </td>
                        <td className="py-2 pr-4">
                          <select value={edit.dept} onChange={(e)=>setEdit({...edit, dept:e.target.value as any})} className="rounded border px-2 py-1 bg-white">
                            <option value="FOH">FOH</option>
                            <option value="BOH">BOH</option>
                            <option value="TRAVEL">TRAVEL</option>
                            <option value="OTHER">OTHER</option>
                            <option value="BANK">Bank Deposit</option>
                          </select>
                        </td>
                        <td className="py-2 pr-4 text-right">
                          <input inputMode="decimal" value={edit.amountStr ? (round2(Math.max(parseFloat(edit.amountStr||"0") - parseFloat(edit.hstStr||"0"),0))).toFixed(2) : "0.00"} readOnly className="rounded border px-2 py-1 bg-gray-50 text-right" />
                        </td>
                        <td className="py-2 pr-4 text-right">
                          <input inputMode="decimal" value={edit.hstStr} onChange={(e)=>setEdit({...edit, hstStr:e.target.value})} className="rounded border px-2 py-1 text-right" />
                        </td>
                        <td className="py-2 pr-4 text-right">
                          <input inputMode="decimal" value={edit.amountStr} onChange={(e)=>setEdit({...edit, amountStr:e.target.value})} className="rounded border px-2 py-1 text-right" />
                        </td>
                        <td className="py-2 pr-4">
                          <div className="flex gap-2">
                            <button className="underline" onClick={saveEdit} type="button">Save</button>
                            <button className="underline" onClick={cancelEdit} type="button">Cancel</button>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr key={r.id} className="border-t">
                      <td className="py-2 pr-4">{dStr}</td>
                      <td className="py-2 pr-4">{r.vendor}</td>
                      <td className="py-2 pr-4">{r.description}</td>
                      <td className="py-2 pr-4">{accountLabel}</td>
                      <td className="py-2 pr-4">{r.dept || ""}</td>
                      <td className="py-2 pr-4 text-right">${Number(r.net).toFixed(2)}</td>
                      <td className="py-2 pr-4 text-right">${Number(r.hst).toFixed(2)}</td>
                      <td className="py-2 pr-4 text-right">${Number(r.amount).toFixed(2)}</td>
                      <td className="py-2 pr-4">
                        <div className="flex gap-3">
                          <button className="underline" onClick={()=>beginEdit(r)} type="button">Edit</button>
                          <button className="underline" onClick={()=>deleteRow(r.id)} type="button">Delete</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Recent quick list (placeholder for now) */}
      <section className="rounded-xl border bg-white">
        <div className="p-4 border-b">
          <h2 className="text-lg font-medium">Recent entries</h2>
        </div>
        <div className="p-4 overflow-x-auto">
          {/* you can populate a compact list here if needed */}
        </div>
      </section>
    </main>
  );
}


