// src/lib/export/qbo.ts
// Build a QuickBooks Online Journal Entry CSV that matches the template:
//   sheet: JE_SampleCSV — columns and order must be exact.
// Accounts are validated against the template's "Accounts" list below.

export type Entry = {
  id?: string;
  date?: any;        // Firestore Timestamp or Date
  amount?: number;   // gross
  hst?: number;      // tax amount (HST)
  net?: number;      // net = amount - hst
  type?: string;     // optional tag (FOH/BOH/etc)
  account?: string;  // target expense account name (must match allowed accounts)
  vendor?: string;
  description?: string; // "Description of order"
};

export type CashIn = {
  id?: string;
  date?: any;        // Firestore Timestamp or Date
  amount?: number;
  source?: string;
  note?: string;
};

// EXACT header order per the template's JE_SampleCSV tab
const HEADER = ["*JournalNo","*JournalDate","*AccountName","*Debits","*Credits","Description","Name","Sales Tax"] as const;

// Allowed accounts copied from the template's hidden "Accounts" sheet.
// NOTE: Keep this in sync with the template the Admin UI is based on.
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

// Utility — normalize Firestore Timestamp/Date to "YYYY-MM-DD"
function toYMD(d: any): string {
  try {
    const real: Date = typeof d?.toDate === "function" ? d.toDate() : (d instanceof Date ? d : new Date(d));
    const y = real.getFullYear();
    const m = String(real.getMonth()+1).padStart(2,"0");
    const dy = String(real.getDate()).padStart(2,"0");
    return `${y}-${m}-${dy}`;
  } catch {
    return "";
  }
}

// --- Helpers for CSV Description text ---
// Trim long descriptions so we don't create giant CSV cells.
const truncate = (s: string, max = 350) =>
  s && s.length > max ? s.slice(0, max - 1) + "…" : s;

// Build "Department - Description of order" from an entry.
// We accept dept from multiple possible fields: dept | type | department.
const entryToDesc = (e: any) => {
  const dept = (e.dept ?? e.type ?? e.department ?? "").toString().trim();
  const text = (e.description ?? e.desc ?? "").toString().trim();
  return [dept, text].filter(Boolean).join(" - ");
};

type BuildArgs = {
  entries: Entry[];
  cashins: CashIn[];               // currently unused in JE build unless includeCashIns provided
  includeCashIns: boolean;
  cashInCreditAccount: string;     // e.g. "1000 Bank" (only used if includeCashIns)
  storeId: string;
  journalNo?: string;              // may be blank
  journalDate: string;             // YYYY-MM-DD (use end of range)
};

// Group and sum by account, then build one petty-cash CREDIT line at the end.
// Enforces that every expense line uses an allowed account (not "1050 Petty Cash").
export function buildQboCsv({
  entries,
  cashins,
  includeCashIns,
  cashInCreditAccount,
  storeId,
  journalNo = "",
  journalDate,
}: BuildArgs): string {
  // --- Validate & normalize entries ---
  const byAccount = new Map<string, {
    debit: number; tax: number; descPieces: string[];
  }>();

  for (const e of entries || []) {
    const gross = Number(e.amount || 0);
    const tax   = Number(e.hst || 0);
    const acct  = String(e.account || "").trim();

    if (!acct || !ALLOWED_ACCOUNTS.has(acct)) {
      throw new Error(`Entry uses account "${acct}", which is not in the allowed Accounts list.`);
    }
    if (acct === "1050 Petty Cash") {
      // The expense lines must debit expense accounts; we reserve Petty Cash for the single CREDIT line.
      throw new Error(`Entry points to "1050 Petty Cash". Please select an expense account from the Accounts list.`);
    }

    if (!byAccount.has(acct)) {
      byAccount.set(acct, { debit: 0, tax: 0, descPieces: [] });
    }
    const acc = byAccount.get(acct)!;
    acc.debit += gross;
    acc.tax += tax;

    // Collect "Dept - Description of order" for this entry
    const desc = entryToDesc(e);
    if (desc) acc.descPieces.push(desc);
  }

  // --- Optional cash-ins handling could go here if needed later ---

  // --- Build CSV rows ---
  const rows: string[][] = [];
  const push = (cols: any[]) => rows.push(cols.map(v => (v == null ? "" : String(v))));

  // header
  push(Array.from(HEADER));

  // Expense debits per account
  let totalDebits = 0;
  for (const [acct, agg] of byAccount) {
    // If an account aggregated negative (e.g., rebates), flip to a CREDIT line
    const sum = Number(agg.debit.toFixed(2));
    const tax = Number(agg.tax.toFixed(2));

    // Build Description = joined "Dept - Description" pieces; fallback to generic if empty
    const description = agg.descPieces.length
      ? truncate(agg.descPieces.join("; "))
      : `${storeId} petty cash — ${acct} (${agg.descPieces.length || 0} items)`;

    if (sum >= 0) {
      push([journalNo, journalDate, acct, sum.toFixed(2), "", description, "", tax ? tax.toFixed(2) : "0.00"]);
      totalDebits += sum;
    } else {
      // negative -> credit this account
      push([journalNo, journalDate, acct, "", Math.abs(sum).toFixed(2), description, "", "0.00"]);
      // credits reduce the petty-cash credit later
      totalDebits += sum; // sum is negative
    }
  }

  // Single petty cash offset line
  const pettyCashCredit = Number(Math.abs(totalDebits).toFixed(2));
  if (totalDebits !== 0) {
    // If totalDebits > 0, we credit petty cash; if < 0 (overall rebate), we debit petty cash.
    const debit = totalDebits < 0 ? pettyCashCredit.toFixed(2) : "";
    const credit = totalDebits > 0 ? pettyCashCredit.toFixed(2) : "";
    push([journalNo, journalDate, "1050 Petty Cash", debit, credit, `${storeId} petty cash offset`, "", "0.00"]);
  }

  // Stringify to CSV with CRLF line endings for Excel/QuickBooks friendliness
  const lines = rows.map(cols => cols.map(escapeCsv).join(",")).join("\r\n") + "\r\n";
  return lines;
}

// Very small CSV escaper: wrap if needed, double internal quotes
function escapeCsv(v: string): string {
  const needs = /[\",\n\r]/.test(v);
  if (!needs) return v;
  return '"' + v.replace(/"/g,'""') + '"';
}

// OPTIONAL helper for /debug preview (returns sample lines and totals)
export function buildQboPreview({
  entries,
  storeId,
  journalNo = "",
  journalDate,
}: Pick<BuildArgs, "entries"|"storeId"|"journalNo"|"journalDate">) {
  const csv = buildQboCsv({
    entries,
    cashins: [],
    includeCashIns: false,
    cashInCreditAccount: "",
    storeId,
    journalNo,
    journalDate
  });
  const sample = csv.split(/\r?\n/).filter(Boolean).slice(0, 3);
  const cols = (line: string) => line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/g);
  let deb = 0, cred = 0;
  for (const line of csv.split(/\r?\n/)) {
    if (!line || line.startsWith("*")) continue;
    const c = cols(line);
    deb += Number(c[3] || 0);
    cred += Number(c[4] || 0);
  }
  return {
    ok: true,
    stage: "csv.preview",
    sample,
    totals: { debits: Number(deb.toFixed(2)), credits: Number(cred.toFixed(2)), balanced: Math.abs(deb-cred) < 0.01 },
  };
}



