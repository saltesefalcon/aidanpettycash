import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import {
  collection, getDocs, query, orderBy, where, Timestamp
} from "firebase/firestore";

export async function GET(
  req: Request,
  { params }: { params: { storeId: string } }
) {
  const storeId = params.storeId;

  // Optional ?from=YYYY-MM-DD&to=YYYY-MM-DD
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1);
  const fromDate = from ? new Date(from + "T00:00:00") : defaultFrom;
  const toDate = to ? new Date(to + "T23:59:59") : now;

  const qy = query(
    collection(db, "stores", storeId, "entries"),
    where("date", ">=", Timestamp.fromDate(fromDate)),
    where("date", "<=", Timestamp.fromDate(toDate)),
    orderBy("date", "asc")
  );

  const snap = await getDocs(qy);
  const rows = snap.docs.map(d => d.data() as any);

  // TEMP HEADERS — will be replaced to match PettyCash_QBO_Template_V19 exactly
  const headers = ["Journal Date","Account","Name","Description","Debits","Credits"];
  const out: string[] = [];
  out.push(headers.join(","));
  const esc = (s: any) => `"${String(s ?? "").replace(/"/g, '""')}"`;

  for (const r of rows) {
    const dt = r?.date?.toDate?.() ?? new Date();
    const ymd = dt.toISOString().slice(0, 10);

    // debit net to expense account
    out.push([esc(ymd), esc(r.account), esc(r.vendor), esc(r.description),
              esc((+r.net || 0).toFixed(2)), esc("0.00")].join(","));

    // debit HST to tax account (placeholder account name — we’ll confirm)
    if (+r.hst > 0) {
      out.push([esc(ymd), esc("HST Paid on Purchases"), esc(r.vendor),
                esc(`HST for ${r.description ?? ""}`),
                esc((+r.hst || 0).toFixed(2)), esc("0.00")].join(","));
    }
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
