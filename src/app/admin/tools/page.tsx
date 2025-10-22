"use client";

import { useEffect, useState } from "react";
import { db } from "@/lib/firebase";
import { collection, getDocs, orderBy, query, DocumentData } from "firebase/firestore";

type Store = { id: string; name?: string };

export default function AdminToolsPage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [from, setFrom] = useState("");
  const [targets, setTargets] = useState<string>(""); // comma-separated
  const [result, setResult] = useState<string>("");

  useEffect(() => {
    (async () => {
      const qy = query(collection(db, "stores"), orderBy("name"));
      const snap = await getDocs(qy);
      const rows: Store[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as DocumentData) }));
      setStores(rows);
      if (!from && rows.length) setFrom(rows[0].id);
    })();
  }, []);

  async function runClone() {
    setResult("Running…");
    try {
      const to = targets
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await fetch("/api/admin/stores/clone-accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from, to }),
      });
      const txt = await res.text();
      setResult(`HTTP ${res.status}\n${txt}`);
    } catch (e: any) {
      setResult(`Error: ${e?.message || String(e)}`);
    }
  }

  return (
    <main className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Admin Tools</h1>

      <div className="rounded-lg border bg-white">
        <div className="p-4 border-b">
          <h2 className="text-lg font-medium">Clone accounts to other stores</h2>
        </div>
        <div className="p-4 space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <label className="block text-sm mb-1">From store (source)</label>
              <select
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="w-full rounded-md border px-3 py-2 bg-white"
              >
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name || s.id}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm mb-1">To stores (comma-separated IDs)</label>
              <input
                placeholder="e.g. beacon, prohibition, tulia"
                value={targets}
                onChange={(e) => setTargets(e.target.value)}
                className="w-full rounded-md border px-3 py-2"
              />
              <p className="text-xs text-gray-600 mt-1">
                Tip: use <code>cesoir</code> as the source, and enter{" "}
                <code>beacon, prohibition, tulia</code> as targets.
              </p>
            </div>
          </div>

          <button
            onClick={runClone}
            className="inline-flex items-center rounded-md border px-4 py-2 text-sm font-medium hover:bg-gray-50"
          >
            Clone accounts
          </button>

          <pre className="text-xs bg-gray-50 p-3 rounded border overflow-x-auto whitespace-pre-wrap">
            {result || "Result will appear here."}
          </pre>
        </div>
      </div>
    </main>
  );
}
