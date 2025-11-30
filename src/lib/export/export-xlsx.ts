'use client';

import * as XLSX from 'xlsx';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where, Timestamp } from 'firebase/firestore';

type Entry = {
  id?: string;
  date?: any;              // Firestore Timestamp
  vendor?: string;         // or supplier
  supplier?: string;       // fallback
  description?: string;    // fallback
  note?: string;
  amount?: number;         // gross
  hst?: number;            // if stored separately
  category?: string;
  month?: string;
};

function toISO(d?: any) {
  try {
    if ((d as Timestamp)?.toDate) return (d as Timestamp).toDate().toISOString().slice(0,10);
  } catch {}
  return '';
}

export async function downloadEntriesXlsx(storeId: string, month: string) {
  const qy = query(collection(db, 'stores', storeId, 'entries'), where('month', '==', month));
  const snap = await getDocs(qy);

  const rows: Entry[] = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));

  const sheetRows = rows
    .filter(r => (r as any).deleted !== true)
    .map(r => ({
      Date: toISO(r.date),
      Vendor: r.vendor ?? r.supplier ?? '',
      Description: r.description ?? r.note ?? '',
      Category: r.category ?? '',
      HST: typeof r.hst === 'number' ? Number(r.hst).toFixed(2) : '',
      Amount: typeof r.amount === 'number' ? Number(r.amount).toFixed(2) : '',
      EntryId: r.id ?? '',
    }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(sheetRows);
  XLSX.utils.book_append_sheet(wb, ws, 'Journal');

  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const blob = new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });

  const file = `pettycash_${storeId}_${month}_journal.xlsx`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = file;
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(a.href);
  a.remove();
}
