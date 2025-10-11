import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import {
  collection, getDocs, query, orderBy, where, Timestamp
} from "firebase/firestore";

const PETTY_CASH_ACCOUNT = "1050 Petty Cash";  // adjust if different in your Accounts
const HST_ACCOUNT_NAME   = "HST ON 13%";       // Sales Tax column value

const ymd = (d: Date) => d.toISOString().slice(0,10);
const esc = (s: any) => `"${String(s ?? "").replace(/"/g, '""')}"`;

export async function GET(
  req: Request,
  { params }: { params: { storeId: string } }
) {
  const { storeId } = params;
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const now = new Date();
  const start = from ? new Date(from + "T00:00:00") : new Date(now.getFullYear(), now.getMonth(), 1);
  const end   = to   ? new Date(to   + "T23:59:59") : now;

  const qy = query(
    collection(db, "stores", storeId, "entries"),
    where("date", ">=", Timestamp.fromDate(start)),
    where("date", "<=", Timestamp.fromDate(end)),
    orderBy("date", "asc")
  );
  const snap = await getDocs(qy);

  const headers = [
    "*JournalNo","*JournalDate","*AccountName","*Debits","*Credits","Description","Name","Sales Tax"
  ];
  const out: string[] = [headers.join(",")];

  for (const d of snap.docs) {
    const r = d.data() as any;
    const dt = r?.date?.toDate?.() ?? new Date();
    const dateStr = ymd(dt);
    const jn = `PC-${storeId}-${dateStr}-${String(d.id).slice(0,6)}`;

    // 1) Debit expense (net)
    out.push([
      esc(jn), esc(dateStr), esc(r.account ?? ""),
      esc(Number(r.net ?? 0).toFixed(2)), esc(""),
      esc(r.description ?? ""), esc(r.vendor ?? ""), esc("Out of Scope")
    ].join(","));

    // 2) Debit HST (if any)
    const h = Number(r.hst ?? 0);
    if (h > 0) {
      out.push([
        esc(jn), esc(dateStr), esc(HST_ACCOUNT_NAME),
        esc(h.toFixed(2)), esc(""),
        esc(`HST for ${r.description ?? ""}`), esc(r.vendor ?? ""), esc("HST ON 13%")
      ].join(","));
    }

    // 3) Credit petty cash (gross)
    out.push([
      esc(jn), esc(dateStr), esc(PETTY_CASH_ACCOUNT),
      esc(""), esc(Number(r.amount ?? 0).toFixed(2)),
      esc(r.description ?? ""), esc(r.vendor ?? ""), esc("Out of Scope")
    ].join(","));
  }

  const csv = out.join("\r\n");
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="petty-cash-${storeId}.csv"`,
    },
  });
}
