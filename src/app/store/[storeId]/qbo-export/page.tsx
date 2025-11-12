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

  const today = useMemo(() => new Date().toISOString().slice(0, 7), []);
  const [month, setMonth] = useState(today);
  const [jn, setJn] = useState(
    `${new Date().toLocaleString("en-US", { month: "short" })}-${new Date().getFullYear()}`
  );
  const [includeCashIns, setIncludeCashIns] = useState(true);
  const [cashInCredit, setCashInCredit] = useState("1000 Bank");
  const [ascii, setAscii] = useState(false);
  const [audit, setAudit] = useState(false);
  const [out, setOut] = useState<string>("");

  const from = `${month}-01`;
  const to = lastDayOfMonth(month);

  async function doPreview() {
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
    const url =
      `/api/store/${storeId}/qbo-export` +
      `?from=${from}&to=${to}` +
      `&jn=${encodeURIComponent(jn)}` +
      `&includeCashIns=${includeCashIns ? "1" : "0"}` +
      `&cashInCreditAccount=${encodeURIComponent(cashInCredit)}` +
      `&ascii=${ascii ? "1" : "0"}`;
    window.location.href = url;
  }

  return (
    <main className="p-6 space-y-4 pb-24">  {/* pb so content doesn't sit under fixed nav */}

      <h1 className="text-2xl font-semibold capitalize">{storeName} · QBO Export</h1>

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
            placeholder="Oct-2025-01"
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

      <div className="flex gap-6 items-center text-sm">
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={includeCashIns} onChange={(e) => setIncludeCashIns(e.target.checked)} />
          Include cash-ins
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={ascii} onChange={(e) => setAscii(e.target.checked)} />
          Force ASCII
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={audit} onChange={(e) => setAudit(e.target.checked)} />
          Audit mode (JSON)
        </label>
      </div>

      <div className="flex gap-3">
        <button onClick={doPreview} className="border rounded px-4 py-2">Preview</button>
        <button onClick={doDownload} className="border rounded px-4 py-2">Download CSV</button>
      </div>

      <pre className="bg-white border rounded p-3 overflow-auto text-xs whitespace-pre-wrap">
        {out || "Preview JSON will appear here."}
      </pre>
      <div className="h-16 md:hidden" />
<MobileNav storeId={String(storeId)} active="qbo" />

    </main>
  );
}
