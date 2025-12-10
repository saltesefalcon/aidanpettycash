"use client";

import React, { useEffect, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  query,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

type ClosingBalanceAudit = {
  id?: string;
  date: any;
  amount: number;
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

function isoDate(ts?: any) {
  return ts?.toDate ? ts.toDate().toISOString().slice(0, 10) : "";
}

function fmtDate(ts?: any) {
  return ts?.toDate ? ts.toDate().toLocaleDateString("en-CA") : "";
}

function toTs(yyyyMmDd: string) {
  return Timestamp.fromDate(new Date(`${yyyyMmDd}T00:00:00`));
}

function getTime(val: any) {
  return val?.toDate ? val.toDate().getTime() : 0;
}

function me() {
  const u = auth.currentUser;
  return {
    uid: u?.uid || "unknown",
    name: u?.displayName || u?.email || "unknown",
    email: u?.email || "",
  };
}

export function ClosingBalanceAuditSection({
  storeId,
  month,
}: {
  storeId: string;
  month: string;
}) {
  const [cbDate, setCbDate] = useState(() => {
    const t = new Date();
    const mm = String(t.getMonth() + 1).padStart(2, "0");
    const dd = String(t.getDate()).padStart(2, "0");
    return `${t.getFullYear()}-${mm}-${dd}`;
  });
  const [cbAmount, setCbAmount] = useState<string>("");
  const [cbNote, setCbNote] = useState<string>("");
  const [showDeleted, setShowDeleted] = useState(false);
  const [rows, setRows] = useState<ClosingBalanceAudit[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<ClosingBalanceAudit | null>(null);

  // Load rows for the selected month (same pattern as deposits/cash-ins)
  useEffect(() => {
    if (!storeId || !month) return;
    (async () => {
      try {
        setErr(null);
        const qy = query(
          collection(db, "stores", storeId, "closingBalanceAudits"),
          where("month", "==", month)
        );
        const snap = await getDocs(qy);
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        })) as ClosingBalanceAudit[];
        list.sort((a, b) => getTime(a.date) - getTime(b.date));
        setRows(list);
      } catch (e: any) {
        setErr(e?.message || String(e));
        setRows([]);
      }
    })();
  }, [storeId, month]);

  const saveNew = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeId || !cbAmount) return;
    try {
      setErr(null);
      const when = toTs(cbDate);
      const user = me();
      await addDoc(collection(db, "stores", storeId, "closingBalanceAudits"), {
        date: when,
        amount: Number.parseFloat(cbAmount),
        note: cbNote || "",
        month,
        createdAt: Timestamp.now(),
        createdByUid: user.uid,
        createdByName: user.name,
        createdByEmail: user.email,
        deleted: false,
      });

      setCbAmount("");
      setCbNote("");

      const qy = query(
        collection(db, "stores", storeId, "closingBalanceAudits"),
        where("month", "==", month)
      );
      const snap = await getDocs(qy);
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as any),
      })) as ClosingBalanceAudit[];
      list.sort((a, b) => getTime(a.date) - getTime(b.date));
      setRows(list);
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  };

  const onSaveEdit = async () => {
    if (!storeId || !editing?.id) return;
    try {
      setErr(null);
      const user = me();
      await updateDoc(
        doc(db, "stores", storeId, "closingBalanceAudits", editing.id),
        {
          date: editing.date,
          amount: Number(editing.amount || 0),
          note: editing.note || "",
          month,
          updatedAt: Timestamp.now(),
          updatedByUid: user.uid,
          updatedByName: user.name,
          updatedByEmail: user.email,
        } as any
      );
      setEditing(null);

      const qy = query(
        collection(db, "stores", storeId, "closingBalanceAudits"),
        where("month", "==", month)
      );
      const snap = await getDocs(qy);
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as any),
      })) as ClosingBalanceAudit[];
      list.sort((a, b) => getTime(a.date) - getTime(b.date));
      setRows(list);
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  };

  const onDelete = async (id?: string) => {
    if (!storeId || !id) return;
    if (!confirm("Delete this closing balance audit entry?")) return;
    try {
      setErr(null);
      const user = me();
      await updateDoc(
        doc(db, "stores", storeId, "closingBalanceAudits", id),
        {
          deleted: true,
          deletedAt: Timestamp.now(),
          deletedByUid: user.uid,
          deletedByName: user.name,
          deletedByEmail: user.email,
        } as any
      );

      const qy = query(
        collection(db, "stores", storeId, "closingBalanceAudits"),
        where("month", "==", month)
      );
      const snap = await getDocs(qy);
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as any),
      })) as ClosingBalanceAudit[];
      list.sort((a, b) => getTime(a.date) - getTime(b.date));
      setRows(list);
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  };

  return (
    <section className="rounded-lg border bg-white p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold">Closing Balance Audit</h2>
        {err && <div className="text-xs text-red-700">{err}</div>}
      </div>

      <form onSubmit={saveNew} className="grid grid-cols-4 gap-3 max-w-4xl">
        <div>
          <label className="block text-sm mb-1">Date</label>
          <input
            type="date"
            value={cbDate}
            onChange={(e) => setCbDate(e.target.value)}
            className="border px-3 py-2 rounded w-full"
            required
          />
        </div>
        <div>
          <label className="block text-sm mb-1">Amount (±)</label>
          <input
            type="number"
            step="0.01"
            value={cbAmount}
            onChange={(e) => setCbAmount(e.target.value)}
            className="border px-3 py-2 rounded w-full"
            required
          />
        </div>
        <div className="col-span-2">
          <label className="block text-sm mb-1">Note</label>
          <input
            type="text"
            value={cbNote}
            onChange={(e) => setCbNote(e.target.value)}
            className="border px-3 py-2 rounded w-full"
          />
        </div>
        <div className="col-span-4">
          <button className="border px-4 py-2 rounded">
            Add closing balance audit
          </button>
        </div>
      </form>

      <div className="mt-4 overflow-x-auto">
        <div className="mb-2 flex items-center gap-4 text-sm">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={showDeleted}
              onChange={(e) => setShowDeleted(e.target.checked)}
            />
            Show deleted
          </label>
        </div>
        <table className="min-w-[720px] text-sm">
          <thead>
            <tr className="text-left border-b">
              <th className="py-2 pr-4">Date</th>
              <th className="py-2 pr-4">Amount</th>
              <th className="py-2 pr-4">Note</th>
              <th className="py-2 pr-4">By</th>
              <th className="py-2 pr-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows
              .filter((r) => showDeleted || !r.deleted)
              .map((r) => {
                const edited = !!r.updatedAt && !r.deleted;
                const rowClass = r.deleted
                  ? "opacity-60 line-through"
                  : edited
                  ? "bg-yellow-50"
                  : "";
                const creator =
                  r.createdByName ||
                  r.createdByEmail ||
                  (r.createdByUid ? `uid:${r.createdByUid}` : "");
                const editor =
                  r.updatedByName ||
                  r.updatedByEmail ||
                  (r.updatedByUid ? `uid:${r.updatedByUid}` : "");

                if (editing?.id === r.id) {
                  return (
                    <tr key={r.id} className="border-b last:border-b-0">
                      <td className="py-2 pr-4">
                        <input
                          type="date"
                          className="border px-2 py-1 rounded"
                          defaultValue={isoDate(r.date)}
                          onChange={(e) =>
                            setEditing((prev) =>
                              prev
                                ? { ...prev, date: toTs(e.target.value) }
                                : prev
                            )
                          }
                        />
                      </td>
                      <td className="py-2 pr-4">
                        <input
                          type="number"
                          step="0.01"
                          defaultValue={String(r.amount)}
                          onChange={(e) =>
                            setEditing((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    amount: Number(e.target.value || 0),
                                  }
                                : prev
                            )
                          }
                          className="border px-2 py-1 rounded w-28"
                        />
                      </td>
                      <td className="py-2 pr-4">
                        <input
                          defaultValue={r.note || ""}
                          onChange={(e) =>
                            setEditing((prev) =>
                              prev ? { ...prev, note: e.target.value } : prev
                            )
                          }
                          className="border px-2 py-1 rounded"
                        />
                      </td>
                      <td className="py-2 pr-4 text-xs">
                        <span
                          title={`Created by ${creator}${
                            editor ? ` • Last edited by ${editor}` : ""
                          }`}
                        >
                          edit…
                        </span>
                      </td>
                      <td className="py-2 pr-4 space-x-2">
                        <button
                          className="underline"
                          type="button"
                          onClick={onSaveEdit}
                        >
                          Save
                        </button>
                        <button
                          className="underline"
                          type="button"
                          onClick={() => setEditing(null)}
                        >
                          Cancel
                        </button>
                      </td>
                    </tr>
                  );
                }

                return (
                  <tr key={r.id} className={`border-b last:border-b-0 ${rowClass}`}>
                    <td className="py-2 pr-4">{fmtDate(r.date)}</td>
                    <td className="py-2 pr-4">
                      {Number(r.amount || 0).toFixed(2)}
                    </td>
                    <td className="py-2 pr-4">{r.note ?? ""}</td>
                    <td className="py-2 pr-4 text-xs">
                      <span
                        className="inline-block rounded px-2 py-0.5 bg-gray-100"
                        title={`Created by ${creator}${
                          editor ? ` • Last edited by ${editor}` : ""
                        }`}
                      >
                        {creator || "—"}
                      </span>
                    </td>
                    <td className="py-2 pr-4 space-x-3">
                      {!r.deleted && (
                        <>
                          <button
                            className="underline"
                            type="button"
                            onClick={() => setEditing(r)}
                          >
                            Edit
                          </button>
                          <button
                            className="underline text-red-700"
                            type="button"
                            onClick={() => onDelete(r.id)}
                          >
                            Delete
                          </button>
                        </>
                      )}
                      {r.deleted && <span className="text-xs">deleted</span>}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
