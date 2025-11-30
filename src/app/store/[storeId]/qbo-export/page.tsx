// src/app/store/[storeId]/qbo-export/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";
import MobileNav from "@/components/MobileNav";

function lastDayOfMonth(yyyyMm: string) {
  const [y, m] = yyyyMm.split("-").map(Number);
  const d = new Date(y, m, 0).getDate();
  return `${yyyyMm}-${String(d).padStart(2, "0")}`;
}

type Mode = "month" | "range";

// Flags used by IdleLogout (we keep your existing TS key and also flip the
// boolean flag used elsewhere so we're covered in all places).
const KEY_DOWNLOAD     = "pc_download_active";     // "1" while downloading
const KEY_DOWNLOAD_TS  = "pc_download_active_ts";  // timestamp, short-lived

export default function QboExportPage() {
  const { storeId } = useParams<{ storeId: string }>();

  // Store display name for the page title
  const [storeName, setStoreName] = useState<string>(storeId || "");
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

  // -------- Inputs --------
  const todayMonth = useMemo(() => new Date().toISOString().slice(0, 7), []);
  const [mode, setMode] = useState<Mode>("month");

  // month mode
  const [month, setMonth] = useState(todayMonth);

  // range mode
  const [fromDate, setFromDate] = useState(`${todayMonth}-01`);
  const [toDate, setToDate] = useState(lastDayOfMonth(todayMonth));

  // shared
  const [jn, setJn] = useState(
    `${new Date().toLocaleString("en-US", { month: "short" })}-${new Date().getFullYear()}`
  );
  const [includeCashIns, setIncludeCashIns] = useState(true);
  const [cashInCredit, setCashInCredit] = useState("1000 Bank");
  const [ascii, setAscii] = useState(false);
  const [audit, setAudit] = useState(false);
  const [out, setOut] = useState<string>("");

  // Effective range based on mode
  const from = mode === "month" ? `${month}-01` : fromDate;
  const to   = mode === "month" ? lastDayOfMonth(month) : toDate;

  const invalidRange =
    !from ||
    !to ||
    Number(new Date(from).getTime()) > Number(new Date(to).getTime());

  // Mark/clear download so IdleLogout won't bounce you
  const markDownload = () => {
    try {
      localStorage.setItem(KEY_DOWNLOAD, "1");
      localStorage.setItem(KEY_DOWNLOAD_TS, String(Date.now()));
    } catch {}
  };
  const clearDownloadSoon = () => {
    setTimeout(() => {
      try { localStorage.removeItem(KEY_DOWNLOAD); } catch {}
    }, 4000);
  };

  async function doPreview() {
    if (invalidRange) {
      setOut(JSON.stringify({ error: "Pick a valid date range" }, null, 2));
      return;
    }
    const url =
      `/api/store/${storeId}/qbo-export` +
      `?from=${from}&to=${to}` +
      `&jn=${encodeURIComponent(jn)}` +
      `&includeCashIns=${includeCashIns ? "1" : "0"}` +
      `&cashInCreditAccount=${encodeURIComponent(cashInCredit)}` +
      `&ascii=${ascii ? "1" : "0"}` +
      `&audit=${audit ? "1" : "0"}` +
      `&debug=1&preview=1`;
    const r = await fetch(url);
    const j = await r.json();
    setOut(JSON.stringify(j, null, 2));
  }

  function doDownload() {
    if (invalidRange) return;
    const url =
      `/api/store/${storeId}/qbo-export` +
      `?from=${from}&to=${to}` +
      `&jn=${encodeURIComponent(jn)}` +
      `&includeCashIns=${includeCashIns ? "1" : "0"}` +
      `&cashInCreditAccount=${encodeURIComponent(cashInCredit)}` +
      `&ascii=${ascii ? "1" : "0"}`;

    // Open in a new tab; mark download so IdleLogout ignores noise.
    markDownload();
    window.open(url, "_blank", "noopener,noreferrer");
    clearDownloadSoon();
  }

  return (
    <main className="p-6 space-y-4 pb-24">
      <h1 className="text-2xl font-semibold capitalize">{storeName} · QBO Export</h1>

      {/* Mode toggle */}
      <div className="flex items-center gap-6 text-sm">
        <label className="inline-flex items-center gap-2">
          <input
            type="radio"
            name="mode"
            value="month"
            checked={mode === "month"}
            onChange={() => setMode("month")}
          />
          By month
        </label>
        <label className="inline-flex items-center gap-2">
          <input
            type="radio"
            name="mode"
            value="range"
            checked={mode === "range"}
            onChange={() => setMode("range")}
          />
          By date range
        </label>
      </div>

      {/* Inputs */}
      {mode === "month" ? (
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className="block text-sm mb-1">Month</label>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="w-full border rounded px-3 py-2"
            />
            <p className="text-xs mt-1 text-gray-600">Range: {from} → {to}</p>
          </div>
          <div>
            <label className="block text-sm mb-1">Journal No</label>
            <input
              value={jn}
              onChange={(e) => setJn(e.target.value)}
              className="w-full border rounded px-3 py-2"
              placeholder="Nov-2025-01"
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Cash-in credit account</label>
            <input
              value={cashInCredit}
              onChange={(e) => setCashInCredit(e.target.value)}
              className="w-full border rounded px-3 py-2"
            />
          </div>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-4">
          <div>
            <label className="block text-sm mb-1">From</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm mb-1">To</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full border rounded px-3 py-2"
            />
            {invalidRange && (
              <p className="text-xs text-red-600 mt-1">Pick a valid date range.</p>
            )}
          </div>
          <div>
            <label className="block text-sm mb-1">Journal No</label>
            <input
              value={jn}
              onChange={(e) => setJn(e.target.value)}
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Cash-in credit account</label>
            <input
              value={cashInCredit}
              onChange={(e) => setCashInCredit(e.target.value)}
              className="w-full border rounded px-3 py-2"
            />
          </div>
        </div>
      )}

      {/* Options */}
      <div className="flex gap-6 items-center text-sm">
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={includeCashIns}
            onChange={(e) => setIncludeCashIns(e.target.checked)}
          />
          Include cash-ins
        </label>
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={ascii}
            onChange={(e) => setAscii(e.target.checked)}
          />
          Force ASCII
        </label>
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={audit}
            onChange={(e) => setAudit(e.target.checked)}
          />
          Audit mode (JSON)
        </label>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button onClick={doPreview} className="border rounded px-4 py-2" disabled={invalidRange}>
          Preview
        </button>
        <button onClick={doDownload} className="border rounded px-4 py-2" disabled={invalidRange}>
          Download CSV
        </button>
      </div>

      <pre className="bg-white border rounded p-3 overflow-auto text-xs whitespace-pre-wrap">
        {out || "Preview JSON will appear here."}
      </pre>

      <div className="h-16 md:hidden" />
      <MobileNav storeId={String(storeId)} active="qbo" />
    </main>
  );
}
