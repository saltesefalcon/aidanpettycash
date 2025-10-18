// src/app/api/store/[storeId]/qbo-export/route.ts
import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { collection, getDocs, query, where, Timestamp } from "firebase/firestore";
import { buildQboCsv } from "@/lib/export/qbo";

// Node runtime + no caching
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Keep in sync with your template's Accounts tab
const ALLOWED_ACCOUNTS = new Set<string>([
  "5110 Purchases:Beer Purchases",
  "5120 Purchases:Food Purchases",
  "6010 Accounting",
  "5130 Purchases:Liquor Purchases",
  "5160 Purchases:Wine Purchases",
  "5250 Purchases:Purchases - Merchandise",
  "5260 Supplier Rebate",
  "6000 Administration",
  "1050 Petty Cash",
]);

// Optional ASCII sanitizer (for Excel edge-cases or legacy tools)
function toAscii(s: string) {
  return s
    // en dash, em dash → hyphen
    .replace(/\u2013|\u2014/g, "-")
    // smart quotes → straight quotes
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    // non-breaking space → space
    .replace(/\u00A0/g, " ");
}

export async function GET(req: Request, { params }: { params: { storeId: string } }) {
  const { storeId } = params;
  const url = new URL(req.url);

  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const jn = url.searchParams.get("jn") ?? "";
  const includeCashIns = url.searchParams.get("includeCashIns") === "1";
  const cashInCreditAccount = url.searchParams.get("cashInCreditAccount") ?? "1000 Bank";

  const debug   = url.searchParams.get("debug") === "1";
  const smoke   = url.searchParams.get("smoke") === "1";
  const preview = url.searchParams.get("preview") === "1";
  const audit   = url.searchParams.get("audit") === "1";
  const ascii   = url.searchParams.get("ascii") === "1"; // force ASCII if needed

  if (!storeId || !from || !to) {
    return NextResponse.json({ ok: false, error: "Missing storeId/from/to" }, { status: 400 });
  }

  // Smoke CSV (no Firestore)
  if (smoke) {
    const BOM = "\uFEFF";
    const sample = "JournalNo,JournalDate,AccountName,Debits,Credits,Description,Name,Sales Tax\r\n";
    return new NextResponse(BOM + sample, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="smoke.csv"`,
      },
    });
  }

  try {
    const startTs = Timestamp.fromDate(new Date(`${from}T00:00:00`));
    const endTs   = Timestamp.fromDate(new Date(`${to}T23:59:59`));

    // entries
    const entQ = query(
      collection(db, "stores", storeId, "entries"),
      where("date", ">=", startTs),
      where("date", "<=", endTs),
    );
    const entSnap = await getDocs(entQ);
    const entries = entSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
    entries.sort(
      (a: any, b: any) =>
        ((a.date?.toDate?.() as Date | undefined)?.getTime() ?? 0) -
        ((b.date?.toDate?.() as Date | undefined)?.getTime() ?? 0)
    );

    // optional cash-ins
    let cashins: any[] = [];
    if (includeCashIns) {
      const ciQ = query(
        collection(db, "stores", storeId, "cashins"),
        where("date", ">=", startTs),
        where("date", "<=", endTs),
      );
      const ciSnap = await getDocs(ciQ);
      cashins = ciSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      cashins.sort(
        (a: any, b: any) =>
          ((a.date?.toDate?.() as Date | undefined)?.getTime() ?? 0) -
          ((b.date?.toDate?.() as Date | undefined)?.getTime() ?? 0)
      );
    }

    // === AUDIT MODE (JSON) ===
    if (audit) {
      const used = new Set<string>();
      const invalid: any[] = [];
      for (const e of entries) {
        const acct = String(e.account || "").trim();
        if (acct) used.add(acct);
        const badName = !acct || !ALLOWED_ACCOUNTS.has(acct);
        const pettyOnExpenseLine = acct === "1050 Petty Cash";
        if (badName || pettyOnExpenseLine) {
          invalid.push({
            id: e.id,
            date: e.date?.toDate?.()?.toISOString?.()?.slice(0,10) ?? null,
            vendor: e.vendor ?? null,
            amount: e.amount ?? null,
            account: acct || null,
            reason: pettyOnExpenseLine
              ? "Expense line cannot use 1050 Petty Cash"
              : "Account not in allowed Accounts list",
          });
        }
      }
      return NextResponse.json({
        ok: true,
        stage: "audit",
        range: { from, to },
        counts: { entries: entries.length, uniqueAccounts: used.size, invalid: invalid.length },
        uniqueAccountsUsed: Array.from(used).sort(),
        invalid,
      });
    }

    // === DEBUG PREVIEW (first lines + totals) ===
    if (debug && preview) {
      const csv0 = buildQboCsv({
        entries, cashins, includeCashIns, cashInCreditAccount,
        storeId, journalNo: jn, journalDate: to!,
      });
      const csv = ascii ? toAscii(csv0) : csv0;
      const lines = csv.split(/\r?\n/).filter(Boolean);
      const sample = lines.slice(0, 3);
      const cols = (line: string) => line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/g);
      let deb = 0, cred = 0;
      for (const line of lines) {
        if (line.startsWith("JournalNo")) continue;
        const c = cols(line);
        deb += Number(c[3] || 0);
        cred += Number(c[4] || 0);
      }
      return NextResponse.json({
        ok: true, stage: "csv.preview", sample,
        totals: { debits: Number(deb.toFixed(2)), credits: Number(cred.toFixed(2)), balanced: Math.abs(deb-cred) < 0.01 },
      });
    }

    // === REAL CSV DOWNLOAD ===
    const csv0 = buildQboCsv({
      entries, cashins, includeCashIns, cashInCreditAccount,
      storeId, journalNo: jn, journalDate: to!,
    });
    const csv = ascii ? toAscii(csv0) : csv0;

    // Add UTF-8 BOM so Excel detects Unicode and doesn’t show “â€””
    const BOM = "\uFEFF";
    return new NextResponse(BOM + csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="pettycash_${storeId}_${from}_to_${to}.csv"`,
      },
    });
  } catch (err: any) {
    const msg = `[qbo-export] ${err?.name || "Error"}: ${err?.message || String(err)}\n${err?.stack || ""}`;
    console.error(msg);
    const isDebug = new URL(req.url).searchParams.get("debug") === "1";
    if (isDebug) {
      return NextResponse.json({ ok: false, stage: "error", error: err?.message || String(err) }, { status: 400 });
    }
    return new NextResponse(msg, { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
