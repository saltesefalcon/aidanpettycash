import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
  Timestamp,
} from "firebase/firestore";

// GET /api/store/:storeId/qbo-export?from=YYYY-MM-DD&to=YYYY-MM-DD
export async function GET(
  req: Request,
  { params }: { params: { storeId: string } }
) {
  try {
    const { storeId } = params;
    const { searchParams } = new URL(req.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    if (!storeId || !from || !to) {
      return new NextResponse("Missing storeId/from/to", { status: 400 });
    }

    const start = Timestamp.fromDate(new Date(`${from}T00:00:00`));
    const end = Timestamp.fromDate(new Date(`${to}T23:59:59`)); // inclusive

    // Range on the same field + orderBy on that field does NOT require a composite index
    const qy = query(
      collection(db, "stores", storeId, "entries"),
      where("date", ">=", start),
      where("date", "<=", end),
      orderBy("date", "asc")
    );

    const snap = await getDocs(qy);
    const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

    const fmtDate = (ts?: any) =>
      ts?.toDate ? ts.toDate().toISOString().slice(0, 10) : "";
    const esc = (s: string) => `"${(s ?? "").replace(/"/g, '""')}"`;
    const money = (n: any) =>
      Number.isFinite(Number(n)) ? Number(n).toFixed(2) : "";

    // CSV scaffold — we’ll map this to your JE template next
    const header = [
      "Date",
      "Vendor",
      "Description",
      "Type",
      "Account",
      "Gross",
      "HST",
      "Net",
    ].join(",");

    const data = rows.map((r) =>
      [
        fmtDate(r.date),
        esc(r.vendor ?? ""),
        esc(r.description ?? ""),
        r.type ?? "",
        esc(r.account ?? ""),
        money(r.amount),
        money(r.hst),
        money(r.net),
      ].join(",")
    );

    const csv = [header, ...data].join("\r\n");

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="pettycash_${storeId}_${from}_to_${to}.csv"`,
      },
    });
  } catch (err: any) {
    console.error(err);
    return new NextResponse("Export failed", { status: 500 });
  }
}

