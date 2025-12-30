// src/app/api/store/[storeId]/qbo-export/route.ts
import { NextResponse } from "next/server";
import { buildQboCsv } from "@/lib/export/qbo";
import { getAdminDb } from "@/lib/admin";
import { Timestamp } from "firebase-admin/firestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Keep in sync with the template Accounts list
const ALLOWED_ACCOUNTS = new Set<string>([
  "0000 Misc",
  "5110 Purchases:Beer Purchases",
  "5120 Purchases:Food Purchases",
  "6110 Administration:Office and admin",
  "6150 Administration:Vehicle operating expenses",
  "6180 Administration:Travel Expenses",
  "6440 Operations:Operating supplies",
  "6445 Operations:Smallwares",
  "5200 Supplier Rebates",
  "5130 Purchases:Liquor Purchases",
  "5160 Purchases:Wine Purchases",
  "5250 Purchases:Purchases - Merchandise",
  "5260 Supplier Rebate",
  "5260 Purchases:Supplier Rebate",
  "6000 Administration",
  "2430 Server Due Backs",
]);

// Optional ASCII sanitizer (Excel-safe)
function toAscii(s: string) {
  return s
    .replace(/\u2013|\u2014/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u00A0/g, " ");
}

export async function GET(req: Request) {
  // Derive storeId from the URL (avoids Next.js type constraints on arg2)
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean); // e.g. ["api","store","beacon","qbo-export"]
  const i = parts.findIndex((p) => p === "store");
  const storeId = i >= 0 ? parts[i + 1] : "";

  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const journalNo = url.searchParams.get("jn") ?? "";
  const includeCashIns = url.searchParams.get("includeCashIns") === "1";
  const cashInCreditAccount = url.searchParams.get("cashInCreditAccount") ?? "1000 Bank";

  const debug = url.searchParams.get("debug") === "1";
  const preview = url.searchParams.get("preview") === "1";
  const smoke = url.searchParams.get("smoke") === "1";
  const audit = url.searchParams.get("audit") === "1";
  const ascii = url.searchParams.get("ascii") === "1";

  if (!storeId || !from || !to) {
    return NextResponse.json({ ok: false, error: "Missing storeId/from/to" }, { status: 400 });
  }

  // Smoke CSV (no Firestore)
  if (smoke) {
    const BOM = "\uFEFF";
    const sample = "*JournalNo,*JournalDate,*AccountName,*Debits,*Credits,Description,Name,Sales Tax\r\n";
    return new NextResponse(BOM + sample, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="smoke.csv"`,
      },
    });
  }

  try {
    const adb = getAdminDb();

    const startTs = Timestamp.fromDate(new Date(`${from}T00:00:00`));
    const endTs = Timestamp.fromDate(new Date(`${to}T23:59:59`));

    // Load accounts (id -> name) so entries that stored an account *id* can be mapped to the display name
    const acctSnap = await adb
      .collection("stores")
      .doc(storeId)
      .collection("accounts")
      .get();

    const accountIdToName = new Map<string, string>();
    acctSnap.forEach((d) => {
      const data = d.data() as any;
      const name = data.name ?? data.fullName ?? data.account ?? "";
      if (name) accountIdToName.set(d.id, name);
    });



    // Per-store petty cash GL name
const PETTY_CASH_BY_STORE: Record<string, string> = {
  beacon: "1001 Petty Cash",
  tulia: "1001 Petty Cash",
  prohibition: "1001 Petty Cash",
  cesoir: "1050 Petty Cash",
};

// Choose the store’s petty-cash account
const pettyCashAccount =
  PETTY_CASH_BY_STORE[(storeId.toLowerCase?.() || storeId)] || "1050 Petty Cash";

// Live Accounts (names) from Settings → Accounts
const liveAccounts = Array.from(new Set<string>(accountIdToName.values()).values());

// Union of static + live + this store’s petty cash
const MERGED_ALLOWED = new Set<string>([
  ...ALLOWED_ACCOUNTS,
  ...liveAccounts,
  pettyCashAccount,
]);

    // Entries
    const entSnap = await adb
      .collection("stores")
      .doc(storeId)
      .collection("entries")
      .where("date", ">=", startTs)
      .where("date", "<=", endTs)
      .get();

    let entries = entSnap.docs
      .map((d) => ({ id: d.id, ...(d.data() as any) }))
      .filter((e: any) => e.deleted !== true); // exclude soft-deleted entries

// Resolve account field to an allowed *name*
entries = entries.map((e: any) => {
  let acc: string =
    (e.account as string) ||
    (e.accountName as string) ||
    accountIdToName.get(e.accountId) ||
    "";
  if (acc && !MERGED_ALLOWED.has(acc)) {
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

    // Optional cash-ins
    let cashins: any[] = [];
    if (includeCashIns) {
      const ciSnap = await adb
        .collection("stores")
        .doc(storeId)
        .collection("cashins")
        .where("date", ">=", startTs)
        .where("date", "<=", endTs)
        .get();

      cashins = ciSnap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        .filter((c: any) => c.deleted !== true); // exclude soft-deleted cash-ins

      cashins.sort(
        (a: any, b: any) =>
          ((a.date?.toDate?.() as Date | undefined)?.getTime() ?? 0) -
          ((b.date?.toDate?.() as Date | undefined)?.getTime() ?? 0)
      );
    }

    // AUDIT mode
    if (audit) {
      const used = new Set<string>();
      const invalid: any[] = [];

      for (const e of entries) {
        const acct = String(e.account || "").trim();
        if (acct) used.add(acct);

        const badName = !acct || !MERGED_ALLOWED.has(acct);
        const pettyOnExpenseLine = acct === pettyCashAccount;

        if (badName || pettyOnExpenseLine) {
          invalid.push({
            id: e.id,
            date:
              e.date?.toDate?.()?.toISOString?.()?.slice(0, 10) ?? null,
            vendor: e.vendor ?? null,
            amount: e.amount ?? null,
            account: acct || null,
            reason: pettyOnExpenseLine
              ? `Expense line cannot use ${pettyCashAccount}`
              : "Account not in allowed list (resolve account IDs to names)",
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

    // DEBUG preview
    if (debug && preview) {
      const csv0 = buildQboCsv({
        entries,
        cashins,
        includeCashIns,
        cashInCreditAccount,
        storeId,
        journalNo,
        journalDate: to!,
        allowedAccounts: Array.from(MERGED_ALLOWED),
        pettyCashAccount, // 👈 use the per-store petty cash GL
      });

      const csv = ascii ? toAscii(csv0) : csv0;
      const lines = csv.split(/\r?\n/).filter(Boolean);
      const cols = (line: string) =>
        line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/g);

      let deb = 0;
      let cred = 0;
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

    // REAL CSV
    const csv0 = buildQboCsv({
      entries,
      cashins,
      includeCashIns,
      cashInCreditAccount,
      storeId,
      journalNo,
      journalDate: to!,
      allowedAccounts: Array.from(MERGED_ALLOWED),
      pettyCashAccount, // 👈 and here
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
    const msg = `[qbo-export] ${err?.name || "Error"}: ${err?.message || String(err)}\n${err?.stack || ""}`;
    console.error(msg);
    const isDebug = new URL(req.url).searchParams.get("debug") === "1";
    if (isDebug) {
      return NextResponse.json({ ok: false, stage: "error", error: err?.message || String(err) }, { status: 400 });
    }
    return new NextResponse(msg, {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}


