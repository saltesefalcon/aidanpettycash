// src/app/api/store/[storeId]/journal-xlsx/route.ts
import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getAdminDb } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, context: any) {
  try {
    const db = getAdminDb();

    const storeId = String(context?.params?.storeId || "").toLowerCase();
    const { searchParams } = new URL(req.url);

    // month OR arbitrary range (month wins if provided)
    const m = searchParams.get("m"); // YYYY-MM (optional)
    const from = searchParams.get("from"); // YYYY-MM-DD (optional)
    const to = searchParams.get("to");     // YYYY-MM-DD (optional)
    const includeCashIns = searchParams.get("includeCashIns") === "1";
    const jn = searchParams.get("jn") || "";
    const cashInCreditAccount = searchParams.get("cashInCreditAccount") || "1000 Bank";

    // Build date boundaries
    const range: { from?: string; to?: string } = {};
    if (m) {
      const [yy, mm] = m.split("-").map(Number);
      const start = new Date(yy, mm - 1, 1);
      const end = new Date(yy, mm, 0);
      const ymd = (d: Date) => d.toISOString().slice(0, 10);
      range.from = ymd(start);
      range.to = ymd(end);
    } else if (from && to) {
      range.from = from;
      range.to = to;
    } else {
      return NextResponse.json({ error: "Provide m=YYYY-MM or from/to" }, { status: 400 });
    }

    // Figure out which month buckets to query
    const targetMonths = new Set<string>();
    if (m) {
      targetMonths.add(m);
    } else {
      const [fy, fm, ty, tm] = [
        Number(range.from!.slice(0, 4)),
        Number(range.from!.slice(5, 7)),
        Number(range.to!.slice(0, 4)),
        Number(range.to!.slice(5, 7)),
      ];
      const cur = new Date(fy, fm - 1, 1);
      const end = new Date(ty, tm - 1, 1);
      while (cur <= end) {
        const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`;
        targetMonths.add(key);
        cur.setMonth(cur.getMonth() + 1);
      }
    }

    type Row = {
      date: string;
      vendor?: string;
      department?: string;
      category?: string;
      note?: string;
      amount: number;
      id: string;
    };
    const rows: Row[] = [];

    // Entries (skip soft-deleted; filter to day range if needed)
    for (const mon of targetMonths) {
      const snap = await db
        .collection("stores")
        .doc(storeId)
        .collection("entries")
        .where("month", "==", mon)
        .get();

      snap.forEach((docSnap) => {
        const d = docSnap.data() as any;
        if (d?.deleted === true) return;
        const iso =
          d?.date?.toDate?.()?.toISOString?.()?.slice(0, 10) || d?.isoDate || "";
        if (range.from && iso && iso < range.from) return;
        if (range.to && iso && iso > range.to) return;

        rows.push({
          id: docSnap.id,
          date: iso,
          vendor: String(d.vendor ?? ""),
          department: String(d.department ?? d.dept ?? ""),
          category: String(d.category ?? ""),
          note: String(d.note ?? ""),
          amount: Number(d.amount || 0),
        });
      });
    }

    // Optional: append cash-ins (credit bank) inside range
    if (includeCashIns) {
      for (const mon of targetMonths) {
        const snap = await db
          .collection("stores")
          .doc(storeId)
          .collection("cashins")
          .where("month", "==", mon)
          .get();

        snap.forEach((docSnap) => {
          const d = docSnap.data() as any;
          if (d?.deleted === true) return;
          const iso = d?.date?.toDate?.()?.toISOString?.()?.slice(0, 10) || "";
          if (range.from && iso && iso < range.from) return;
          if (range.to && iso && iso > range.to) return;

          rows.push({
            id: `cashin-${docSnap.id}`,
            date: iso,
            vendor: "Cash-in",
            department: "",
            category: cashInCreditAccount,
            note: String(d.note ?? ""),
            amount: Number(d.amount || 0) * -1,
          });
        });
      }
    }

    // Build workbook
    const wsData = [
      ["Journal #", jn],
      ["Store", storeId],
      ["From", range.from],
      ["To", range.to],
      [],
      ["Date", "Vendor", "Department", "Category", "Note", "Amount", "EntryID"],
      ...rows
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
        .map((r) => [r.date, r.vendor, r.department, r.category, r.note, r.amount, r.id]),
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, "Journal");

    const out = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const fname = m
      ? `journal_${storeId}_${m}.xlsx`
      : `journal_${storeId}_${range.from}_${range.to}.xlsx`;

    return new Response(out as ArrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fname}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
