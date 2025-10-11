// src/lib/export/qbo.ts
// QBO Journal Entry CSV builder aligned to JE_SampleCSV

// EXACT header order from PettyCash_QBO_Template_V19.xlsx → JE_SampleCSV
export const COLUMNS = [
  "*JournalNo",
  "*JournalDate",
  "*AccountName",
  "*Debits",
  "*Credits",
  "Description",
  "Name",
  "Sales Tax",
];

// Set these to your QBO account names EXACTLY (case/spacing)
export const PETTY_CASH_ACCOUNT = "1050 Petty Cash";

// If you track recoverable HST as a separate account, set it here.
// If left blank (""), HST will be folded into the expense debit.
export const HST_RECOVERABLE_ACCOUNT = ""; // e.g. "1410 HST Recoverable"

const esc = (s: string) => `"${String(s ?? "").replace(/"/g, '""')}"`;
const money = (n: any) =>
  Number.isFinite(Number(n)) ? Number(n).toFixed(2) : "";
const fmtDate = (ts?: any) =>
  ts?.toDate ? ts.toDate().toISOString().slice(0, 10) : String(ts ?? "");

// Build 2–3 CSV rows per petty entry:
//  DR Expense (net [+ HST if no HST account])
//  DR HST Recoverable (if account set & hst > 0)
//  CR Petty Cash (gross)
function entryToLines(r: any, storeId: string): string[] {
  const d = fmtDate(r.date);
  const desc = `${r.type ?? ""} ${r.description ?? ""}`.trim();
  const name = r.vendor ?? "";
  const expenseAccount = r.account ?? ""; // must match your QBO account name
  const gross = Number(r.amount || 0);
  const hst = Number(r.hst || 0);
  const netCalc = Number.isFinite(Number(r.net)) ? Number(r.net) : gross - hst;

  let expenseDebit = netCalc;
  const lines: string[] = [];

  if (hst > 0 && HST_RECOVERABLE_ACCOUNT) {
    // DR Expense (net)
    lines.push([
      "", d, esc(expenseAccount), money(expenseDebit), "", esc(desc), esc(name), ""
    ].join(","));
    // DR HST Recoverable (hst)
    lines.push([
      "", d, esc(HST_RECOVERABLE_ACCOUNT), money(hst), "", esc(desc), esc(name), ""
    ].join(","));
  } else {
    // No HST account configured → fold HST into expense
    expenseDebit = gross;
    lines.push([
      "", d, esc(expenseAccount), money(expenseDebit), "", esc(desc), esc(name), ""
    ].join(","));
  }

  // CR Petty Cash (gross)
  lines.push([
    "", d, esc(PETTY_CASH_ACCOUNT), "", money(gross), esc(desc), esc(name), ""
  ].join(","));

  return lines;
}

// Cash-in (refill) JE (if included):
//  DR Petty Cash
//  CR credit account (e.g., Bank)
function cashInToLines(ci: any, creditAccount: string, storeId: string): string[] {
  const d = fmtDate(ci.date);
  const desc = ci.note ? String(ci.note) : "Petty cash refill";
  const amt = Number(ci.amount || 0);
  const name = ci.source ?? "";

  return [
    ["", d, esc(PETTY_CASH_ACCOUNT), money(amt), "", esc(desc), esc(name), ""].join(","),
    ["", d, esc(creditAccount), "", money(amt), esc(desc), esc(name), ""].join(","),
  ];
}

export function buildQboCsv(opts: {
  entries: any[];
  cashins?: any[];
  includeCashIns?: boolean;
  cashInCreditAccount?: string; // e.g., "1000 Bank"
  storeId: string;
}) {
  const {
    entries,
    cashins = [],
    includeCashIns = false,
    cashInCreditAccount = "1000 Bank",
    storeId,
  } = opts;

  const header = COLUMNS.join(",");
  const body: string[] = [];

  for (const r of entries) body.push(...entryToLines(r, storeId));
  if (includeCashIns) {
    for (const ci of cashins) body.push(...cashInToLines(ci, cashInCreditAccount, storeId));
  }

  return [header, ...body].join("\r\n");
}

// Back-compat (entries only)
export function entriesToQboCsv(rows: any[], storeId: string) {
  return buildQboCsv({ entries: rows, storeId });
}

