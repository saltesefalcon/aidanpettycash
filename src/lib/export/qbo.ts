// src/lib/export/qbo.ts
// QBO Journal Entry CSV scaffold.
// 🔧 Edit COLUMNS + account constants to match your PettyCash_QBO_Template_V19.xlsx EXACTLY.

export const COLUMNS = [
  "TxnDate",     // e.g., 2025-10-11
  "RefNumber",   // optional (leave blank)
  "Memo",        // description / type
  "Account",     // QBO account name
  "Debit",
  "Credit",
  "Name",        // vendor
  "Class",       // FOH/BOH/OTHER/TRAVEL (optional)
  "Location"     // store/location (optional)
];

export const PETTY_CASH_ACCOUNT = "1050 Petty Cash";          // <-- match QBO name
export const HST_RECOVERABLE_ACCOUNT = "1410 HST Recoverable"; // <-- match QBO name

const esc = (s: string) => `"${(s ?? "").replace(/"/g, '""')}"`;
const money = (n: any) => (Number.isFinite(Number(n)) ? Number(n).toFixed(2) : "");
const fmtDate = (ts?: any) => (ts?.toDate ? ts.toDate().toISOString().slice(0, 10) : "");

export function entriesToQboCsv(rows: any[], storeId: string) {
  const header = COLUMNS.join(",");
  const lines: string[] = [header];

  for (const r of rows) {
    const txnDate = fmtDate(r.date);
    const memo = `${r.type ?? ""} ${r.description ?? ""}`.trim();
    const name = r.vendor ?? "";
    const klass = r.type ?? "";     // FOH/BOH/OTHER/TRAVEL
    const location = storeId;

    const expenseAccount = r.account ?? ""; // ensure this matches your QBO expense account name
    const gross = Number(r.amount || 0);
    const hst = Number(r.hst || 0);
    const net = Number.isFinite(Number(r.net)) ? Number(r.net) : gross - hst;

    // DR Expense (net)
    lines.push([
      txnDate, "", esc(memo), esc(expenseAccount), money(net), "", esc(name), esc(klass), esc(location)
    ].join(","));

    // DR HST Recoverable (if any)
    if (hst > 0) {
      lines.push([
        txnDate, "", esc(memo), esc(HST_RECOVERABLE_ACCOUNT), money(hst), "", esc(name), esc(klass), esc(location)
      ].join(","));
    }

    // CR Petty Cash (gross)
    lines.push([
      txnDate, "", esc(memo), esc(PETTY_CASH_ACCOUNT), "", money(gross), esc(name), esc(klass), esc(location)
    ].join(","));
  }

  return lines.join("\r\n");
}
