// src/lib/export/qbo.ts
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

export const PETTY_CASH_ACCOUNT = "1050 Petty Cash";
// Set to "" to roll HST into expense debit; otherwise split to this account.
export const HST_RECOVERABLE_ACCOUNT = ""; // e.g., "1410 HST Recoverable"

const esc = (s: string) => `"${String(s ?? "").replace(/"/g, '""')}"`;
const money = (n: any) =>
  Number.isFinite(Number(n)) ? Number(n).toFixed(2) : "";

// NOTE: We will pass a single journalDate string (YYYY-MM-DD) for the WHOLE export.
function entryToLines(r: any, storeId: string, jn: string, journalDate: string): string[] {
  const d = journalDate; // single JE date for all rows
  const desc = `${r.type ?? ""} ${r.description ?? ""}`.trim();
  const name = r.vendor ?? "";
  const expenseAccount = r.account ?? "";
  const gross = Number(r.amount || 0);
  const hst = Number(r.hst || 0);
  const netCalc = Number.isFinite(Number(r.net)) ? Number(r.net) : gross - hst;

  let expenseDebit = netCalc;
  const lines: string[] = [];

  if (hst > 0 && HST_RECOVERABLE_ACCOUNT) {
    lines.push([jn, d, esc(expenseAccount), money(expenseDebit), "", esc(desc), esc(name), ""].join(","));
    lines.push([jn, d, esc(HST_RECOVERABLE_ACCOUNT), money(hst), "", esc(desc), esc(name), ""].join(","));
  } else {
    expenseDebit = gross;
    lines.push([jn, d, esc(expenseAccount), money(expenseDebit), "", esc(desc), esc(name), ""].join(","));
  }
  lines.push([jn, d, esc(PETTY_CASH_ACCOUNT), "", money(gross), esc(desc), esc(name), ""].join(","));
  return lines;
}

function cashInToLines(ci: any, creditAccount: string, storeId: string, jn: string, journalDate: string): string[] {
  const d = journalDate; // single JE date
  const desc = ci.note ? String(ci.note) : "Petty cash refill";
  const amt = Number(ci.amount || 0);
  const name = ci.source ?? "";

  return [
    [jn, d, esc(PETTY_CASH_ACCOUNT), money(amt), "", esc(desc), esc(name), ""].join(","),
    [jn, d, esc(creditAccount), "", money(amt), esc(desc), esc(name), ""].join(","),
  ];
}

export function buildQboCsv(opts: {
  entries: any[];
  cashins?: any[];
  includeCashIns?: boolean;
  cashInCreditAccount?: string;
  storeId: string;
  journalNo?: string;      // NEW: single JournalNo for entire file
  journalDate: string;     // NEW: single JournalDate (YYYY-MM-DD) for entire file
}) {
  const {
    entries,
    cashins = [],
    includeCashIns = false,
    cashInCreditAccount = "1000 Bank",
    storeId,
    journalNo,
    journalDate,
  } = opts;

  // If the user didn't supply one, create a simple placeholder they can edit in Excel.
  const jn = (journalNo && journalNo.trim()) || `PC-${journalDate.replace(/-/g, "")}`;

  const header = COLUMNS.join(",");
  const body: string[] = [];

  for (const r of entries) body.push(...entryToLines(r, storeId, jn, journalDate));
  if (includeCashIns) {
    for (const ci of cashins) body.push(...cashInToLines(ci, cashInCreditAccount, storeId, jn, journalDate));
  }
  return [header, ...body].join("\r\n");
}

// Back-compat helper if needed
export function entriesToQboCsv(rows: any[], storeId: string, journalNo: string, journalDate: string) {
  return buildQboCsv({ entries: rows, storeId, journalNo, journalDate });
}


