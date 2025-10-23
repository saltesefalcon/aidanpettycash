// src/app/api/store/[storeId]/qbo-export/route.ts
import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { collection, getDocs, query, where, Timestamp } from "firebase/firestore";
import { buildQboCsv } from "@/lib/export/qbo";

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
    .replace(/\u2013|\u2014/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u00A0/g, " ");
}

// --- CSV description helpers (used by qbo.ts) ---
const truncate = (s: string, max = 350) =>
  s.length > max ? s.slice(0, max - 1) + "…" : s;

const entryToDesc = (e: any) => {
  const dept = (e.dept ?? e.type ?? e.department ?? "").toString().trim();
  const text = (e.description ?? e.desc ?? "").toString().trim();
  return [dept, text].filter(Boolean).join(" - ");
};

export async function GET(req: Request) {
  // derive storeId from URL
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean); // e.g. ["api","store","beacon","qbo-export"]
  const i = parts.findIndex(p => p === "store");
  const storeId = i >= 0 ? parts[i + 1] : "";

  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const jn = url.searchParams.get("jn") ?? "";
  const includeCashIns = url.searchParams.get("includeCashIns") === "1";
  const cashInCreditAccount = url.searchParams.get("cashInCreditAccount") ?? "1000 Bank";

  const debug   = url.searchParams.get("debug") === "1";
  const smoke   = url.searchParams.get("smoke") === "1";
  const preview = url.searchParams.get("preview") === "1";
  const audit   = url.searchParams.get("audit") === "1";
  const ascii   = url.searchParams.get("ascii") === "1";

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

    // entries in range
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

    // ── NEW: resolve account ids -> names for legacy entries ─────────
    // Some older entries saved e.account as the account document id.
    // We load /stores/{storeId}/accounts and replace ids with their names.
    const accSnap = await getDocs(collection(db, "stores", storeId, "accounts"));
    const idToName = new Map<string, string>();
    accSnap.forEach(docSnap => {
      const a = docSnap.data() as any;
      // prefer a.name (should match “5110 Purchases:Beer Purchases” etc.)
      const name =
        (a?.name ?? a?.qboName ?? a?.fullName ?? a?.path ?? "").toString().trim();
      if (name) idToName.set(docSnap.id, name);
    });

    for (const e of entries) {
      const acct = (e.account ?? "").toString().trim();
      if (acct && !ALLOWED_ACCOUNTS.has(acct) && idToName.has(acct)) {
        e.account = idToName.get(acct);
      }
    }
    // ────────────────────────────────────────────────────────────────

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
      const cols = (line: string) => line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/g);
      let deb = 0, cred = 0;
      for (const line of lines) {
        if (line.startsWith("JournalNo")) continue;
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

    // === REAL CSV DOWNLOAD ===
    const csv0 = buildQboCsv({
      entries, cashins, includeCashIns, cashInCreditAccount,
      storeId, journalNo: jn, journalDate: to!,
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
    return new NextResponse(msg, { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
