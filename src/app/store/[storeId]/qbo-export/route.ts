import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import {
  collection, getDocs, query, orderBy, where, Timestamp
} from "firebase/firestore";

export async function GET(
  _req: Request,
  { params }: { params: { storeId: string } }
) {
  const storeId = params.storeId;

  // TODO: adjust date window from querystring (?from=YYYY-MM-DD&to=YYYY-MM-DD)
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const fromTs = Timestamp.fromDate(monthStart);

  const qy = query(
    collection(db, "stores", storeId, "entries"),
    where("date", ">=", fromTs),
    orderBy("date", "asc")
  );

  const snap = await getDocs(qy);
  const rows = snap.docs.map(d => d.data() as any);

  // 🔧 HEADERS PLACEHOLDER — will replace with your exact V19 template columns
  const headers = [
    "Journal Date","Account","Name","Description","Debits","Credits"
  ];

  // For now: only build debit lines (expense + HST). Petty Cash credit will be added manually.
  const csvLines: string[] = [];
  csvLines.push(headers.join(","));

  for (const r of rows) {
    const dt = r.date?.toDate?.() ?? new Date();
    const ymd = dt.toISOString().slice(0,10);

    // debit net to expense account
    csvLines.push([
      ymd,
      r.account ?? "",
      r.vendor ?? "",
      r.description ?? "",
      Number(r.net ?? 0).toFixed(2),
      "0.00"
    ].map(s => `"${String(s).replace(/"/g,'""')}"`).join(","));

    // debit HST to tax account (placeholder account name; we’ll match your exact account)
    if ((r.hst ?? 0) > 0) {
      csvLines.push([
        ymd,
        "HST Paid on Purchases", // TODO: confirm exact account name/code from your template
        r.vendor ?? "",
        `HST for ${r.description ?? ""}`,
        Number(r.hst ?? 0).toFixed(2),
        "0.00"
      ].map(s => `"${String(s).replace(/"/g,'""')}"`).join(","));
    }
  }

  const csv = csvLines.join("\r\n");
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="petty-cash-${storeId}.csv"`,
    },
  });
}
