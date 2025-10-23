// src/app/api/store/[storeId]/qbo-export/route.ts
import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import {
  collection,
  getDocs,
  query,
  where,
  Timestamp,
} from "firebase/firestore";
import { buildQboCsv } from "@/lib/export/qbo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Keep in sync with the template Accounts list
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

// Optional ASCII sanitizer (Excel-safe)
function toAscii(s: string) {
  return s
    .replace(/\u2013|\u2014/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u00A0/g, " ");
}

type Ctx = { params: { storeId: string } };

export async function GET(req: Request, { params }: Ctx) {
  const { storeId } = params;

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const journalNo = url.searchParams.get("jn") ?? "";
  const includeCashIns = url.searchParams.get("includeCashIns") === "1";
  const cashInCreditAccount =
    url.searchParams.get("cashInCreditAccount") ?? "1000 Bank";

  const debug = url.searchParams.get("debug") === "1";
  const preview = url.searchParams.get("preview") === "1";
  const smoke = url.searchParams.get("smoke") === "1";
  const audit = url.searchParams.get("audit") === "1";
  const ascii = url.searchParams.get("ascii") === "1";

  if (!storeId || !from || !to) {
    return NextResponse.json(
      { ok: false, error: "Missing storeId/from/to" },
      { status: 400 }
    );
  }

  // Smoke CSV (no Firestore)
  if (smoke) {
    const BOM = "\uFEFF";
    const sample =
      "*JournalNo,*JournalDate,*AccountName,*Debits,*Credits,Description,Name,Sales Tax\r\n";
    return new NextResponse(BOM + sample, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="smoke.csv"`,
      },
    });
  }

  try {
    const startTs = Timestamp.fromDate(new Date(`${from}T00:00:00`));
    const endTs = Timestamp.fromDate(new Date(`${to}T23:59:59`));

    // -------- load accounts (id -> name) so we can resolve entries that store an accountId --------
    const acctSnap = await getDocs(
      collection(db, "stores", storeId, "accounts")
    );
    const accountIdToName = new Map<string, string>();
    acctSnap.forEach((d) => {
      // try a few common field names
      const name =
        (d.get("name") as string) ??
        (d.get("fullName") as string) ??
        (d.get("account") as string) ??
        "";
      if (name) accountIdToName.set(d.id, name);
    });

    // -------- entries --------
    const entQ = query(
      collection(db, "stores", storeId, "entries"),
      where("date", ">=", startTs),
      where("date", "<=", endTs)
    );
    const entSnap = await getDocs(entQ);
    let entries = entSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

    // Resolve account IDs -> names (handles stores that saved accountId instead of the textual name)
    entries = entries.map((e: any) => {
      let acc: string =
        (e.account as string) ||
        (e.accountName as string) ||
        accountIdToName.get(e.accountId) ||
        "";
      // If the saved "account" value looks like a doc id and maps to a known account, swap it
      if (acc && !ALLOWED_ACCOUNTS.has(acc)) {
        const mapped =
          accountIdToName.get(acc) ||
          (e.accountId ? accountIdToName.get(e.accountId) : undefined);
        if (mapped) acc = mapped;
      }
      return { ...e, account: acc };
    });

    // Sort by date
    entries.sort(
      (a: any, b: any) =>
        ((a.date?.toDate?.() as Date | undefined)?.getTime() ?? 0) -
        ((b.date?.toDate?.() as Date | undefined)?.getTime() ?? 0)
    );

    // -------- optional cash-ins --------
    let cashins: any[] = [];
    if (includeCashIns) {
      const ciQ = query(
        collection(db, "stores", storeId, "cashins"),
        where("date", ">=", startTs),
        where("date", "<=", endTs)
      );
      const ciSnap = await getDocs(ciQ);
      cashins = ciSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      cashins.sort(
        (a: any, b: any) =>
          ((a.date?.toDate?.() as Date | undefined)?.getTime() ?? 0) -
          ((b.date?.toDate?.() as Date | undefined)?.getTime() ?? 0)
      );
    }

    // -------- AUDIT mode (validate accounts etc.) --------
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
            date:
              e.date?.toDate?.()?.toISOString?.()?.slice(0, 10) ?? null,
            vendor: e.vendor ?? null,
            amount: e.amount ?? null,
            account: acct || null,
            reason: pettyOnExpenseLine
              ? "Expense line cannot use 1050 Petty Cash"
              : "Account not in allowed Accounts list (resolve your account IDs to names)",
          });
        }
      }
      return NextResponse.json({
        ok: true,
        stage: "audit",
        range: { from, to },
        counts: {
          entries: entries.length,
          uniqueAccounts: used.size,
          invalid: invalid.length,
        },
        uniqueAccountsUsed: Array.from(used).sort(),
        invalid,
      });
    }

    // -------- DEBUG preview --------
    if (debug && preview) {
      const csv0 = buildQboCsv({
        entries,
        cashins,
        includeCashIns,
        cashInCreditAccount,
        storeId,
        journalNo,
        journalDate: to!,
      });
      const csv = ascii ? toAscii(csv0) : csv0;
      const lines = csv.split(/\r?\n/).filter(Boolean);
      const cols = (line: string) =>
        line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/g);
      let deb = 0,
        cred = 0;
      for (const line of lines) {
        if (line.startsWith("*JournalNo")) continue;
        const c = cols(line);
        deb += Number(c[3] || 0);
        cred += Number(c[4] || 0);
      }
      return NextResponse.json({
        ok: true,
        stage: "csv.preview",
        sample: lines.slice(0, 3),
        totals: {
          debits: Number(deb.toFixed(2)),
          credits: Number(cred.toFixed(2)),
          balanced: Math.abs(deb - cred) < 0.01,
        },
      });
    }

    // -------- REAL CSV --------
    const csv0 = buildQboCsv({
      entries,
      cashins,
      includeCashIns,
      cashInCreditAccount,
      storeId,
      journalNo,
      journalDate: to!,
    });
    const csv = ascii ? toAscii(csv0) : csv0;

    const BOM = "\uFEFF";
    return new NextResponse(BOM + csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="pettycash_${storeId}_${from}_to_${to}.csv"`,
      },
    });
  } catch (err: any) {
    const msg = `[qbo-export] ${err?.name || "Error"}: ${
      err?.message || String(err)
    }\n${err?.stack || ""}`;
    console.error(msg);
    const isDebug = new URL(req.url).searchParams.get("debug") === "1";
    if (isDebug) {
      return NextResponse.json(
        { ok: false, stage: "error", error: err?.message || String(err) },
        { status: 400 }
      );
    }
    return new NextResponse(msg, {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
