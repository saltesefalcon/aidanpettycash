'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { jsPDF } from 'jspdf';

import { auth, db, storage } from '@/lib/firebase';
import { getIdTokenOrThrow } from '@/lib/getIdToken';
import { STORE_INFO, type StoreId } from '@/lib/stores';

import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { getDownloadURL, ref as sRef, uploadBytes } from 'firebase/storage';

type Category = 'FOOD' | 'BEER' | 'WINE' | 'LIQUOR';
type Role = 'admin' | 'manager' | '';

const UNIT_OPTIONS = [
  'oz',
  'lb',
  'kg',
  'fl oz',
  'ml',
  'l',
  'piece',
  'case',
  '750ml',
  '1140ml',
  '20l keg',
  '30l keg',
  '50l keg',
  '58l keg',
] as const;

type UnitOption = (typeof UNIT_OPTIONS)[number];

type ItemDraft = {
  name: string;
  qty: string;
  unit: UnitOption | '';
  unitCost: string;
  comment: string;
};

type TransferItem = {
  name: string;
  qty: number;
  unit: UnitOption;
  unitCost: number;
  lineTotal: number;
  comment?: string;
};

type EmailStatus = 'not_sent' | 'sent' | 'failed';

type TransferDoc = {
  id: string;

  createdAt?: any;
  createdBy?: { uid: string; email?: string | null };

  updatedAt?: any;
  updatedBy?: { uid: string; email?: string | null; name?: string | null };

  deleted?: boolean;
  deletedAt?: any;
  deletedByUid?: string;
  deletedByEmail?: string;
  deletedByName?: string;

  flagged?: boolean;
  flagNote?: string;
  flaggedAt?: any;
  flaggedByUid?: string;
  flaggedByEmail?: string;
  flaggedByName?: string;

  date: any; // Timestamp
  month: string;

  fromStoreId: StoreId;
  toStoreId: StoreId;

  category: Category;

  items: TransferItem[];

  amountTotal: number; // sum of line totals
  hst: number;         // optional
  net: number;         // amountTotal + hst

  notes?: string;

  invoiceNumber: string;

  invoiceOutStoragePath: string;
  invoiceOutUrl: string;
  invoiceInStoragePath: string;
  invoiceInUrl: string;

  email?: {
    status?: EmailStatus;
    sentAt?: any;
    failedAt?: any;
    error?: string;
    to?: string[];
    subject?: string;
  };
};

function toTitle(s: string) {
  return (s || '').toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}
function yyyyMmFromDate(dateStr: string) {
  return (dateStr || '').slice(0, 7);
}
function yyyymmdd(dateStr: string) {
  return (dateStr || '').replaceAll('-', '');
}
function addMonths(yyyyMm: string, offset: number) {
  const [y, m] = yyyyMm.split('-').map(Number);
  const d = new Date(y, (m - 1) + offset, 1);
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${yy}-${mm}`;
}
function monthLabel(yyyyMm: string) {
  const [y, m] = yyyyMm.split('-').map(Number);
  const d = new Date(y, (m - 1), 1);
  return d.toLocaleString(undefined, { month: 'long', year: 'numeric' });
}
function money(n: number | undefined) {
  const v = Number.isFinite(n as any) ? Number(n) : 0;
  return `$${v.toFixed(2)}`;
}
function clampErr(s: any) {
  const txt = String(s ?? '');
  return txt.length > 500 ? txt.slice(0, 500) + '…' : txt;
}

async function nextTransferInvoiceNumber(dateStr: string) {
  const key = yyyymmdd(dateStr); // YYYYMMDD
  const counterRef = doc(db, 'transferCounters', key);

  const seq = await runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);
    const current = snap.exists() ? Number((snap.data() as any).next || 1) : 1;
    tx.set(counterRef, { next: current + 1, updatedAt: serverTimestamp() }, { merge: true });
    return current;
  });

  return `TR-${key}-${String(seq).padStart(4, '0')}`;
}

function buildTransferPdf(args: {
  invoiceNumber: string;
  dateStr: string;
  fromName: string;
  toName: string;
  category: string;
  directionLabel: string; // "TRANSFER OUT (NEGATIVE)" / "TRANSFER IN (POSITIVE)"
  sign: 1 | -1;           // +1 receiver, -1 sender
  items: TransferItem[];
  amountTotal: number;
  hst: number;
  net: number;
  notes?: string;
}) {
  const W_IN = 10;
  const H_IN = 8;

  const docp = new jsPDF({ orientation: 'landscape', unit: 'pt', format: [W_IN * 72, H_IN * 72] });
  const pageW = W_IN * 72;
  const pageH = H_IN * 72;
  const M = 24;

  docp.setFont('helvetica', 'bold');
  docp.setFontSize(16);
  docp.text('Aidan Transfer Invoice', M, M + 6);

  docp.setFont('helvetica', 'normal');
  docp.setFontSize(10);

  const meta = [
    `Invoice: ${args.invoiceNumber}`,
    `Date: ${args.dateStr}`,
    `From: ${args.fromName}`,
    `To: ${args.toName}`,
    `Category: ${args.category}`,
    `${args.directionLabel}`,
  ];
  meta.forEach((t, i) => docp.text(t, M, M + 28 + i * 14));

  const cols = [
    { label: 'Product', w: 320, align: 'left' as const },
    { label: 'Qty/Unit', w: 100, align: 'right' as const },
    { label: 'Unit $', w: 90, align: 'right' as const },
    { label: 'Line $', w: 110, align: 'right' as const },
  ];

  const tableLeft = M;
  const tableTop = M + 130;
  const tableRight = pageW - M;

  const colX: number[] = [];
  let x = tableLeft;
  for (const c of cols) {
    colX.push(x);
    x += c.w;
  }

  docp.setFont('courier', 'bold');
  docp.setFontSize(10);

  let y = tableTop;
  cols.forEach((c, i) => {
    const tx = c.align === 'right' ? colX[i] + c.w : colX[i];
    docp.text(c.label, tx, y, c.align === 'right' ? { align: 'right' } : undefined);
  });

  docp.setFont('courier', 'normal');
  const rowH = 14;
  y += rowH;

  const clip = (str: string, wPts: number) => {
    const maxChars = Math.floor(wPts / 6);
    const s = String(str ?? '');
    return s.length > maxChars ? s.slice(0, maxChars - 1) + '…' : s;
  };

  for (const it of args.items) {
    if (y > pageH - M * 4) {
      docp.addPage([W_IN * 72, H_IN * 72], 'landscape');
      y = M;

      docp.setFont('courier', 'bold');
      cols.forEach((c, i) => {
        const tx = c.align === 'right' ? colX[i] + c.w : colX[i];
        docp.text(c.label, tx, y, c.align === 'right' ? { align: 'right' } : undefined);
      });

      docp.setFont('courier', 'normal');
      y += rowH;
    }

    const qtyUnit = `${it.qty} ${it.unit}`;
    const signedLine = it.lineTotal * args.sign;

    docp.text(clip(it.name + (it.comment ? ` (${it.comment})` : ''), cols[0].w), colX[0], y);
    docp.text(qtyUnit, colX[1] + cols[1].w, y, { align: 'right' });
    docp.text(`${args.sign < 0 ? '-' : ''}${money(it.unitCost)}`, colX[2] + cols[2].w, y, { align: 'right' });
    docp.text(`${signedLine < 0 ? '-' : ''}${money(Math.abs(signedLine))}`, colX[3] + cols[3].w, y, { align: 'right' });

    y += rowH;
  }

  const signedAmount = args.amountTotal * args.sign;
  const signedHst = args.hst * args.sign;
  const signedNet = args.net * args.sign;

  y = Math.max(y + rowH, pageH - M - rowH * 4);
  docp.setFont('courier', 'bold');
  docp.setFontSize(11);

  const fmtSigned = (v: number) => (v < 0 ? `-${money(Math.abs(v))}` : money(v));

  docp.text(`Amount: ${fmtSigned(signedAmount)}`, tableRight, y, { align: 'right' }); y += rowH;
  docp.text(`HST: ${fmtSigned(signedHst)}`, tableRight, y, { align: 'right' }); y += rowH;
  docp.text(`Net: ${fmtSigned(signedNet)}`, tableRight, y, { align: 'right' });

  if (args.notes?.trim()) {
    docp.setFont('helvetica', 'normal');
    docp.setFontSize(10);
    docp.text(`Notes: ${args.notes.trim()}`, M, pageH - M, { maxWidth: pageW - M * 2 });
  }

  return docp;
}

function defaultItems(): ItemDraft[] {
  return [{ name: '', qty: '', unit: '', unitCost: '', comment: '' }];
}

function DollarField(props: {
  value: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  disabled?: boolean;
  placeholder?: string;
  inputMode?: React.InputHTMLAttributes<HTMLInputElement>['inputMode'];
  wrapperClassName?: string;
  inputClassName?: string;
}) {
  const {
    wrapperClassName = '',
    inputClassName = '',
    inputMode = 'decimal',
    ...rest
  } = props;

  return (
    <div className={`relative ${wrapperClassName}`}>
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm opacity-60">$</span>
      <input
        {...rest}
        inputMode={inputMode}
        className={`w-full border rounded px-3 py-2 pl-7 ${inputClassName}`}
      />
    </div>
  );
}

export default function TransfersPage() {
  const params = useParams() as { storeId: string };
  const storeIdParam = (params?.storeId || '').toLowerCase();
  const storeKey = (storeIdParam as StoreId) in STORE_INFO ? (storeIdParam as StoreId) : 'beacon';

  // Role (admin-only actions like flag + send)
  const [role, setRole] = React.useState<Role>('');
  const [scope, setScope] = React.useState<'company' | 'thisStore'>('thisStore');
  const isAdmin = role === 'admin';
  React.useEffect(() => {
  if (role === 'admin') setScope('company');
  if (role === 'manager') setScope('thisStore');
}, [role]);
  const effectiveScope = isAdmin ? scope : 'thisStore';

  React.useEffect(() => {
    const u = auth.currentUser;
    if (!u?.uid) return;
    (async () => {
      const snap = await getDoc(doc(db, 'memberships', u.uid));
      const data = snap.exists() ? (snap.data() as any) : {};
      setRole((data.role as Role) || '');
    })();
  }, []);

  const [selectedMonth, setSelectedMonth] = React.useState(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  });

  const [showDeleted, setShowDeleted] = React.useState(false);

  const [loading, setLoading] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [sendingId, setSendingId] = React.useState<string>('');
  const [error, setError] = React.useState<string>('');

  const [transfers, setTransfers] = React.useState<TransferDoc[]>([]);

  // --- Edit mode ---
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editingInvoiceNumber, setEditingInvoiceNumber] = React.useState<string>('');

  // --- Form state ---
  const [dateStr, setDateStr] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [fromStoreId, setFromStoreId] = React.useState<StoreId>(storeKey);
  const [toStoreId, setToStoreId] = React.useState<StoreId>(() => {
    const other = (Object.keys(STORE_INFO) as StoreId[]).find((k) => k !== storeKey);
    return other || 'tulia';
  });
  const [category, setCategory] = React.useState<Category>('FOOD');
  const [notes, setNotes] = React.useState('');
  const [items, setItems] = React.useState<ItemDraft[]>(defaultItems());

  // Totals like Petty Cash
  const [hstStr, setHstStr] = React.useState<string>('0.00');

  const storeOptions = React.useMemo(() => {
    return (Object.keys(STORE_INFO) as StoreId[]).map((id) => ({ id, name: STORE_INFO[id].name }));
  }, []);

  async function loadMonth(month: string) {
    setLoading(true);
    setError('');
    try {
      const qy = query(collection(db, 'transfers'), where('month', '==', month));
      const snap = await getDocs(qy);
      const rows: TransferDoc[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      setTransfers(rows);
    } catch (e: any) {
      console.error(e);
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    loadMonth(selectedMonth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth]);

  function updateItem(i: number, patch: Partial<ItemDraft>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function addLine() {
    setItems((prev) => [...prev, { name: '', qty: '', unit: '', unitCost: '', comment: '' }]);
  }
  function removeLine(i: number) {
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i)));
  }

  const computed = React.useMemo(() => {
    // Enforce: must have name + qty + unit + unitCost
    const normalized: TransferItem[] = items
      .map((it) => {
        const name = it.name.trim();
        const qty = Number(it.qty);
        const unit = (it.unit || '') as UnitOption | '';
        const unitCost = Number(it.unitCost);

        const validQty = Number.isFinite(qty) && qty > 0 ? qty : 0;
        const validUnit = (UNIT_OPTIONS as readonly string[]).includes(unit);
        const validCost = Number.isFinite(unitCost) && unitCost >= 0 ? unitCost : NaN;

        if (!name || !validQty || !validUnit || !Number.isFinite(validCost)) return null;

        const lineTotal = validQty * validCost;
        const comment = it.comment.trim();

        // IMPORTANT: no undefined fields (Firestore rejects undefined)
        return {
          name,
          qty: validQty,
          unit: unit as UnitOption,
          unitCost: validCost,
          lineTotal,
          ...(comment ? { comment } : {}),
        } as TransferItem;
      })
      .filter(Boolean) as TransferItem[];

    const amountTotal = normalized.reduce((s, it) => s + it.lineTotal, 0);

    const hstNum = Number(hstStr);
    const hst = Number.isFinite(hstNum) && hstNum >= 0 ? hstNum : 0;

    const net = amountTotal + hst;

    return { normalized, amountTotal, hst, net };
  }, [items, hstStr]);

  const monthTransfers = React.useMemo(() => {
    let rows = [...transfers];

    if (!showDeleted) rows = rows.filter((t) => !t.deleted);

    rows.sort((a, b) => {
      const ad = (a.date?.toDate?.() ? a.date.toDate() : new Date(a.date)) as Date;
      const bd = (b.date?.toDate?.() ? b.date.toDate() : new Date(b.date)) as Date;
      return bd.getTime() - ad.getTime();
    });

    const effectiveScope = isAdmin ? scope : 'thisStore';

    if (effectiveScope === 'company') return rows;
    return rows.filter((t) => t.fromStoreId === storeKey || t.toStoreId === storeKey);
  }, [transfers, scope, isAdmin, storeKey, showDeleted]);


  const byCategory = React.useMemo(() => {
    const buckets: Record<Category, TransferDoc[]> = { FOOD: [], BEER: [], WINE: [], LIQUOR: [] };
    for (const t of monthTransfers) buckets[t.category]?.push(t);
    return buckets;
  }, [monthTransfers]);

  function startEdit(t: TransferDoc) {
    const d = t.date?.toDate?.() ? t.date.toDate() : new Date(t.date);
    const dStr = d.toISOString().slice(0, 10);

    setEditingId(t.id);
    setEditingInvoiceNumber(t.invoiceNumber);

    setDateStr(dStr);
    setFromStoreId(t.fromStoreId);
    setToStoreId(t.toStoreId);
    setCategory(t.category);
    setNotes(t.notes || '');

    // FIX: toFixed must be on a NUMBER
    const safeHst = Number.isFinite(Number((t as any).hst)) ? Number((t as any).hst) : 0;
    setHstStr(safeHst.toFixed(2));

    const draftItems: ItemDraft[] =
      (t.items || []).map((it) => ({
        name: it.name || '',
        qty: String(it.qty ?? ''),
        unit: ((it.unit as UnitOption) || '') as any,
        unitCost: String(Number.isFinite(it.unitCost as any) ? it.unitCost : ''),
        comment: it.comment || '',
      })) || defaultItems();

    setItems(draftItems.length ? draftItems : defaultItems());
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditingInvoiceNumber('');
    setDateStr(new Date().toISOString().slice(0, 10));
    setNotes('');
    setCategory('FOOD');
    setFromStoreId(storeKey);
    const other = (Object.keys(STORE_INFO) as StoreId[]).find((k) => k !== storeKey) || 'tulia';
    setToStoreId(other);
    setItems(defaultItems());
    setHstStr('0.00');
  }

  async function softDelete(t: TransferDoc) {
    // eslint-disable-next-line no-alert
    if (!window.confirm('Delete this transfer?')) return;
    try {
      const u = auth.currentUser;
      if (!u?.uid) throw new Error('Not signed in');

      await updateDoc(doc(db, 'transfers', t.id), {
        deleted: true,
        deletedAt: serverTimestamp(),
        deletedByUid: u.uid,
        deletedByEmail: u.email || '',
        deletedByName: u.displayName || u.email || '',
        updatedAt: serverTimestamp(),
        updatedBy: { uid: u.uid, email: u.email || null, name: u.displayName || u.email || null },
      } as any);

      await loadMonth(selectedMonth);
    } catch (e: any) {
      // eslint-disable-next-line no-alert
    window.alert(e?.message || String(e));
    }
  }

  async function toggleFlag(t: TransferDoc) {
    if (!isAdmin) return;
    try {
      const u = auth.currentUser;
      if (!u?.uid) throw new Error('Not signed in');

      if (t.flagged) {
        await updateDoc(doc(db, 'transfers', t.id), {
          flagged: false,
          flagNote: '',
          updatedAt: serverTimestamp(),
          updatedBy: { uid: u.uid, email: u.email || null, name: u.displayName || u.email || null },
        } as any);
      } else {
        // eslint-disable-next-line no-alert
        const note = window.prompt('Flag note (optional):', t.flagNote || '') || '';
        await updateDoc(doc(db, 'transfers', t.id), {
          flagged: true,
          flagNote: note.trim(),
          flaggedAt: serverTimestamp(),
          flaggedByUid: u.uid,
          flaggedByEmail: u.email || '',
          flaggedByName: u.displayName || u.email || '',
          updatedAt: serverTimestamp(),
          updatedBy: { uid: u.uid, email: u.email || null, name: u.displayName || u.email || null },
        } as any);
      }

      await loadMonth(selectedMonth);
    } catch (e: any) {
      // eslint-disable-next-line no-alert
    window.alert(e?.message || String(e));
    }
  }

  async function sendInvoice(t: TransferDoc) {
    if (!isAdmin) return;

    try {
      setSendingId(t.id);

      const token = await getIdTokenOrThrow();
      const res = await fetch(`/api/store/${t.fromStoreId}/notify-transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ transferId: t.id }),
      });
      const out = await res.json().catch(() => ({}));

      if (!res.ok || !out?.ok) {
        throw new Error(out?.error || `Send failed (${res.status})`);
      }

      await loadMonth(selectedMonth);
    } catch (e: any) {
      // eslint-disable-next-line no-alert
    window.alert(e?.message || String(e));
    } finally {
      setSendingId('');
    }
  }

  async function onSubmit() {
    setSubmitting(true);
    setError('');

    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Not signed in');

      if (!dateStr) throw new Error('Choose a date');
      if (!fromStoreId || !toStoreId || fromStoreId === toStoreId) throw new Error('Select valid From/To stores');
      if (!category) throw new Error('Select a category');
      if (computed.normalized.length === 0) throw new Error('Add at least one item with name + qty + unit + unit cost');

      const month = yyyyMmFromDate(dateStr);
      const invoiceNumber = editingId ? editingInvoiceNumber : await nextTransferInvoiceNumber(dateStr);

      const fromName = STORE_INFO[fromStoreId].name;
      const toName = STORE_INFO[toStoreId].name;

      // PDFs: OUT = negative, IN = positive
      const pdfOut = buildTransferPdf({
        invoiceNumber,
        dateStr,
        fromName,
        toName,
        category,
        directionLabel: 'TRANSFER OUT (NEGATIVE)',
        sign: -1,
        items: computed.normalized,
        amountTotal: computed.amountTotal,
        hst: computed.hst,
        net: computed.net,
        notes: notes.trim() || undefined,
      });

      const pdfIn = buildTransferPdf({
        invoiceNumber,
        dateStr,
        fromName,
        toName,
        category,
        directionLabel: 'TRANSFER IN (POSITIVE)',
        sign: 1,
        items: computed.normalized,
        amountTotal: computed.amountTotal,
        hst: computed.hst,
        net: computed.net,
        notes: notes.trim() || undefined,
      });

      const blobOut = pdfOut.output('blob');
      const blobIn = pdfIn.output('blob');

      const outPath = `transfers/${month}/${invoiceNumber}-OUT.pdf`;
      const inPath = `transfers/${month}/${invoiceNumber}-IN.pdf`;

      await uploadBytes(sRef(storage, outPath), blobOut, { contentType: 'application/pdf' });
      await uploadBytes(sRef(storage, inPath), blobIn, { contentType: 'application/pdf' });

      const outUrl = await getDownloadURL(sRef(storage, outPath));
      const inUrl = await getDownloadURL(sRef(storage, inPath));

      // IMPORTANT: payload must contain NO undefined values
      const payload: any = {
        updatedAt: serverTimestamp(),
        updatedBy: { uid: user.uid, email: user.email || null, name: user.displayName || user.email || null },

        date: Timestamp.fromDate(new Date(`${dateStr}T12:00:00`)),
        month,

        fromStoreId,
        toStoreId,
        category,

        items: computed.normalized,
        amountTotal: computed.amountTotal,
        hst: computed.hst,
        net: computed.net,

        notes: notes.trim() || '',

        invoiceNumber,

        invoiceOutStoragePath: outPath,
        invoiceOutUrl: outUrl,
        invoiceInStoragePath: inPath,
        invoiceInUrl: inUrl,

        email: { status: 'not_sent' as const },
      };

      if (!editingId) {
        await addDoc(collection(db, 'transfers'), {
          createdAt: serverTimestamp(),
          createdBy: { uid: user.uid, email: user.email || null },
          ...payload,
        });
      } else {
        await updateDoc(doc(db, 'transfers', editingId), payload);
      }

      await loadMonth(month);
      cancelEdit();
      setSelectedMonth(month);

      alert(editingId ? 'Transfer updated (not sent).' : 'Transfer logged (not sent).');
    } catch (e: any) {
      console.error(e);
      setError(e?.message || String(e));
    } finally {
      setSubmitting(false);
    }
  }

  // ===== Exports (Excel) =====
  async function exportRowsToXlsx(rows: TransferDoc[], filename: string) {
    const XLSX = await import('xlsx');

    const out: any[] = [];
    for (const t of rows) {
      const d = t.date?.toDate?.() ? t.date.toDate() : new Date(t.date);
      const date = d.toISOString().slice(0, 10);

      const fromName = STORE_INFO[t.fromStoreId]?.name || t.fromStoreId;
      const toName = STORE_INFO[t.toStoreId]?.name || t.toStoreId;

      for (const it of t.items || []) {
        out.push({
          Invoice: t.invoiceNumber,
          Date: date,
          Month: t.month,
          From: fromName,
          To: toName,
          Category: t.category,
          Item: it.name,
          Qty: it.qty,
          Unit: it.unit,
          UnitCost: it.unitCost,
          LineTotal: it.lineTotal,
          AmountTotal: t.amountTotal,
          HST: t.hst,
          Net: t.net,
          Notes: t.notes || '',
          EmailStatus: t.email?.status || 'not_sent',
          Flagged: t.flagged ? 'YES' : '',
          FlagNote: t.flagNote || '',
          Deleted: t.deleted ? 'YES' : '',
        });
      }

      // Handle case: no items (should not happen, but keeps export safe)
      if (!t.items?.length) {
        out.push({
          Invoice: t.invoiceNumber,
          Date: date,
          Month: t.month,
          From: fromName,
          To: toName,
          Category: t.category,
          Item: '',
          Qty: '',
          Unit: '',
          UnitCost: '',
          LineTotal: '',
          AmountTotal: t.amountTotal,
          HST: t.hst,
          Net: t.net,
          Notes: t.notes || '',
          EmailStatus: t.email?.status || 'not_sent',
          Flagged: t.flagged ? 'YES' : '',
          FlagNote: t.flagNote || '',
          Deleted: t.deleted ? 'YES' : '',
        });
      }
    }

    const ws = XLSX.utils.json_to_sheet(out);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Transfers');

    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  }

  async function downloadMonthXlsx() {
    const rows = monthTransfers; // respects scope + showDeleted filter
    await exportRowsToXlsx(rows, `aidan_transfers_${selectedMonth}.xlsx`);
  }

  const [rangeStart, setRangeStart] = React.useState('');
  const [rangeEnd, setRangeEnd] = React.useState('');

  async function downloadRangeXlsx() {
    if (!rangeStart || !rangeEnd) {
      alert('Choose a start and end date.');
      return;
    }
    const start = Timestamp.fromDate(new Date(`${rangeStart}T00:00:00`));
    const end = Timestamp.fromDate(new Date(`${rangeEnd}T23:59:59`));

    setLoading(true);
    try {
      // NOTE: if Firestore asks for an index, it will give you a link to create it.
      const qy = query(collection(db, 'transfers'), where('date', '>=', start), where('date', '<=', end));
      const snap = await getDocs(qy);
      let rows: TransferDoc[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

      // Optional: keep same scope behavior
      if (!showDeleted) rows = rows.filter((t) => !t.deleted);
      if (scope === 'thisStore') rows = rows.filter((t) => t.fromStoreId === storeKey || t.toStoreId === storeKey);

      rows.sort((a, b) => {
        const ad = (a.date?.toDate?.() ? a.date.toDate() : new Date(a.date)) as Date;
        const bd = (b.date?.toDate?.() ? b.date.toDate() : new Date(b.date)) as Date;
        return bd.getTime() - ad.getTime();
      });

      await exportRowsToXlsx(rows, `aidan_transfers_${rangeStart}_to_${rangeEnd}.xlsx`);
    } catch (e: any) {
      // eslint-disable-next-line no-alert
    window.alert(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  const Header = (
    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
      <div>
        <div className="text-2xl font-semibold">{toTitle(storeKey)} · Transfers</div>
        <div className="text-sm opacity-70">
          Monthly sheet: <span className="font-medium">{monthLabel(selectedMonth)}</span> ({selectedMonth})
        </div>
        <div className="text-xs opacity-60 mt-1">
          Stored in Firestore <span className="font-mono">transfers</span> collection (by month) with PDFs in Storage under <span className="font-mono">transfers/YYYY-MM/</span>.
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="text-sm opacity-70 mr-2">Month</div>

        <button className="border rounded px-2 py-1 bg-white" onClick={() => setSelectedMonth((m) => addMonths(m, -1))}>
          ‹
        </button>

        <div className="border rounded px-3 py-1 bg-white text-sm">
          {monthLabel(selectedMonth)} <span className="opacity-60">({selectedMonth})</span>
        </div>

        <button className="border rounded px-2 py-1 bg-white" onClick={() => setSelectedMonth((m) => addMonths(m, +1))}>
          ›
        </button>

        {isAdmin ? (
          <div className="ml-4 flex items-center gap-2">
            <button
              className={['border rounded px-3 py-1 text-sm', scope === 'company' ? 'bg-black text-white' : 'bg-white'].join(' ')}
              onClick={() => setScope('company')}
              title="Shows all transfers for the selected month across all stores."
            >
              All company
            </button>

            <button
              className={['border rounded px-3 py-1 text-sm', scope === 'thisStore' ? 'bg-black text-white' : 'bg-white'].join(' ')}
              onClick={() => setScope('thisStore')}
              title="Shows only transfers involving the current store."
            >
              This store only
            </button>
          </div>
        ) : (
          <div className="ml-4 text-sm opacity-70">
            Scope: <span className="font-medium">This store only</span>
          </div>
        )}


        <label className="ml-4 text-sm flex items-center gap-2">
          <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} />
          Show deleted
        </label>
      </div>
    </div>
  );

  const Form = (
    <div className="border rounded-xl bg-white">
      <div className="px-5 py-4 border-b flex items-center justify-between">
        <div className="text-lg font-semibold">{editingId ? `Edit transfer (${editingInvoiceNumber})` : 'Log a transfer'}</div>
        {editingId ? (
          <button className="text-sm underline" onClick={cancelEdit} type="button">
            Cancel edit
          </button>
        ) : null}
      </div>

      <div className="p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="text-sm font-medium">Date</label>
            <input className="mt-1 w-full border rounded px-3 py-2" type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
          </div>

          <div>
            <label className="text-sm font-medium">From</label>
            <select className="mt-1 w-full border rounded px-3 py-2 bg-white" value={fromStoreId} onChange={(e) => setFromStoreId(e.target.value as StoreId)}>
              {storeOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium">To</label>
            <select className="mt-1 w-full border rounded px-3 py-2 bg-white" value={toStoreId} onChange={(e) => setToStoreId(e.target.value as StoreId)}>
              {storeOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium">Category</label>
            <select className="mt-1 w-full border rounded px-3 py-2 bg-white" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
              <option value="FOOD">FOOD</option>
              <option value="BEER">BEER</option>
              <option value="WINE">WINE</option>
              <option value="LIQUOR">LIQUOR</option>
            </select>
          </div>
        </div>

        <div className="border rounded-lg">
          <div className="px-4 py-3 border-b font-medium">Items</div>
          <div className="p-4 space-y-3">
            {items.map((it, idx) => {
              const unitChosen = Boolean(it.unit);
              const costLabel = unitChosen ? `Cost per ${it.unit}` : 'Cost per';

              return (
                <div key={idx} className="grid grid-cols-1 md:grid-cols-12 gap-2 border rounded-lg p-3">
                  <div className="md:col-span-5">
                    <label className="text-xs font-medium opacity-70">Item</label>
                    <input className="mt-1 w-full border rounded px-3 py-2" value={it.name} onChange={(e) => updateItem(idx, { name: e.target.value })} />
                  </div>

                  <div className="md:col-span-2">
                    <label className="text-xs font-medium opacity-70">Qty</label>
                    <input className="mt-1 w-full border rounded px-3 py-2" value={it.qty} onChange={(e) => updateItem(idx, { qty: e.target.value })} inputMode="decimal" />
                  </div>

                  <div className="md:col-span-2">
                    <label className="text-xs font-medium opacity-70">Unit</label>
                    <select
                      className="mt-1 w-full border rounded px-3 py-2 bg-white"
                      value={it.unit}
                      onChange={(e) => {
                        const val = e.target.value as UnitOption | '';
                        // if unit cleared, also clear cost
                        updateItem(idx, { unit: val, unitCost: val ? it.unitCost : '' });
                      }}
                    >
                      <option value="">Select…</option>
                      {UNIT_OPTIONS.map((u) => (
                        <option key={u} value={u}>{u}</option>
                      ))}
                    </select>
                  </div>

                  <div className="md:col-span-2">
                    <label className="text-xs font-medium opacity-70">{costLabel}</label>
                  <DollarField
                    wrapperClassName="mt-1"
                    inputClassName="disabled:bg-gray-100"
                    value={it.unitCost}
                    onChange={(e) => updateItem(idx, { unitCost: e.target.value })}
                    disabled={!unitChosen}
                    placeholder={unitChosen ? '' : 'Choose unit first'}
                  />

                  </div>

                  <div className="md:col-span-1 flex md:flex-col justify-between items-end">
                    <button className="text-sm underline opacity-80 hover:opacity-100" onClick={() => removeLine(idx)} type="button">
                      Remove
                    </button>
                  </div>

                  <div className="md:col-span-12">
                    <label className="text-xs font-medium opacity-70">Comment (optional)</label>
                    <input className="mt-1 w-full border rounded px-3 py-2" value={it.comment} onChange={(e) => updateItem(idx, { comment: e.target.value })} />
                  </div>
                </div>
              );
            })}

            <button className="border rounded px-3 py-2 bg-white text-sm hover:bg-gray-50" onClick={addLine} type="button">
              + Add line
            </button>
          </div>
        </div>

        {/* Totals (match Petty Cash style) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="text-sm font-medium">Amount (total)</label>
            <DollarField
              wrapperClassName="mt-1"
              inputClassName="bg-gray-50"
              value={computed.amountTotal.toFixed(2)}
              disabled
            />
          </div>

          <div>
            <label className="text-sm font-medium">
              HST (optional) <span className="text-xs opacity-70 ml-2">13%</span>{' '}
              <button
                type="button"
                className="text-xs underline opacity-70 hover:opacity-100 ml-2"
                onClick={() => setHstStr((computed.amountTotal * 0.13).toFixed(2))}
              >
                apply
              </button>{' '}
              <button
                type="button"
                className="text-xs underline opacity-70 hover:opacity-100 ml-2"
                onClick={() => setHstStr('0.00')}
              >
                clear
              </button>
            </label>
           <DollarField
              wrapperClassName="mt-1"
              value={hstStr}
              onChange={(e) => setHstStr(e.target.value)}
            />
          </div>

          <div>
            <label className="text-sm font-medium">Net (auto)</label>
            <DollarField
              wrapperClassName="mt-1"
              inputClassName="bg-gray-50"
              value={computed.net.toFixed(2)}
              disabled
            />
          </div>
        </div>

        <div>
          <label className="text-sm font-medium">Notes (optional)</label>
          <input className="mt-1 w-full border rounded px-3 py-2" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="text-sm">
            <span className="opacity-70">Net (auto):</span> <span className="font-semibold">{money(computed.net)}</span>
          </div>

          <button className="border rounded px-4 py-2 bg-black text-white disabled:opacity-50" disabled={submitting} onClick={onSubmit} type="button">
            {submitting ? 'Saving…' : editingId ? 'Update Transfer' : 'Log Transfer'}
          </button>
        </div>

        {error ? <div className="text-sm text-red-600 border border-red-200 bg-red-50 rounded p-3">{error}</div> : null}
      </div>
    </div>
  );

  function emailBadge(status: EmailStatus) {
    const cls =
      status === 'sent'
        ? 'bg-green-50 text-green-700 border border-green-200'
        : status === 'failed'
        ? 'bg-red-50 text-red-700 border border-red-200'
        : 'bg-gray-50 text-gray-700 border border-gray-200';

    const label = status === 'not_sent' ? 'not sent' : status;

    return { cls, label };
  }

  function Section({ title, rows }: { title: string; rows: TransferDoc[] }) {
    return (
      <div className="border rounded-xl bg-white overflow-hidden">
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <div className="font-semibold">{title}</div>
          <div className="text-xs opacity-70">{rows.length} row(s)</div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[1200px] w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="text-left">
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">From</th>
                <th className="px-4 py-3">To</th>
                <th className="px-4 py-3">Summary</th>
                <th className="px-4 py-3">Net</th>
                <th className="px-4 py-3">Invoice</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const d = t.date?.toDate?.() ? t.date.toDate() : new Date(t.date);
                const date = d.toISOString().slice(0, 10);

                const summary = t.items?.length ? `${t.items[0].name}${t.items.length > 1 ? ` +${t.items.length - 1}` : ''}` : '';
                const status = (t.email?.status as EmailStatus) || 'not_sent';
                const badge = emailBadge(status);

                const fromName = STORE_INFO[t.fromStoreId]?.name || t.fromStoreId;
                const toName = STORE_INFO[t.toStoreId]?.name || t.toStoreId;

                const viewLinks =
                  scope === 'company'
                    ? (
                      <div className="flex gap-3">
                        {t.invoiceOutUrl ? <a className="underline" href={t.invoiceOutUrl} target="_blank" rel="noreferrer">Out</a> : <span className="opacity-50">Out</span>}
                        {t.invoiceInUrl ? <a className="underline" href={t.invoiceInUrl} target="_blank" rel="noreferrer">In</a> : <span className="opacity-50">In</span>}
                      </div>
                    )
                    : (storeKey === t.fromStoreId
                        ? (t.invoiceOutUrl ? <a className="underline" href={t.invoiceOutUrl} target="_blank" rel="noreferrer">View</a> : <span className="opacity-50">View</span>)
                        : (t.invoiceInUrl ? <a className="underline" href={t.invoiceInUrl} target="_blank" rel="noreferrer">View</a> : <span className="opacity-50">View</span>)
                      );

                const canSend = isAdmin && !t.deleted;

                const sendLabel =
                  status === 'sent' ? 'Resend' : status === 'failed' ? 'Retry send' : 'Send';

                return (
                  <tr key={t.id} className={`border-t ${t.flagged ? 'text-red-700' : ''} ${t.deleted ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3">{date}</td>
                    <td className="px-4 py-3">{fromName}</td>
                    <td className="px-4 py-3">{toName}</td>
                    <td className="px-4 py-3">{summary}</td>
                    <td className="px-4 py-3" title={`Amount ${money(t.amountTotal)} + HST ${money(t.hst)}`}>
                      {money(t.net)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      <div>{t.invoiceNumber}</div>
                      <div className="mt-1">{viewLinks}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={['inline-flex items-center px-2 py-1 rounded text-xs', badge.cls].join(' ')}
                        title={t.email?.error ? clampErr(t.email.error) : ''}
                      >
                        {badge.label}
                      </span>
                      {t.flagged && t.flagNote ? <div className="text-xs mt-1 opacity-80">⚑ {t.flagNote}</div> : null}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3 flex-wrap">
                        <button className="underline" type="button" onClick={() => startEdit(t)}>Edit</button>
                        <button className="underline" type="button" onClick={() => softDelete(t)}>Delete</button>
                        {isAdmin ? (
                          <button className="underline" type="button" onClick={() => toggleFlag(t)}>
                            {t.flagged ? 'Unflag' : 'Flag'}
                          </button>
                        ) : null}

                        {canSend ? (
                          <button
                            className="underline"
                            type="button"
                            disabled={sendingId === t.id}
                            onClick={() => sendInvoice(t)}
                          >
                            {sendingId === t.id ? 'Sending…' : sendLabel}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {!rows.length ? (
                <tr className="border-t">
                  <td className="px-4 py-4 opacity-60" colSpan={8}>
                    No transfers in this category for {monthLabel(selectedMonth)}.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const Exports = (
    <div className="border rounded-xl bg-white overflow-hidden">
      <div className="px-5 py-4 border-b font-semibold">Exports</div>
      <div className="p-5 space-y-4">
        <button
          className="w-full border rounded px-4 py-3 bg-white hover:bg-gray-50"
          type="button"
          onClick={downloadMonthXlsx}
        >
          Download Journal (Excel) — {selectedMonth}
        </button>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div>
            <label className="text-sm font-medium">Start date</label>
            <input className="mt-1 w-full border rounded px-3 py-2" type="date" value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} />
          </div>
          <div>
            <label className="text-sm font-medium">End date</label>
            <input className="mt-1 w-full border rounded px-3 py-2" type="date" value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} />
          </div>
          <button className="border rounded px-4 py-3 bg-black text-white disabled:opacity-50" type="button" onClick={downloadRangeXlsx} disabled={loading}>
            {loading ? 'Loading…' : 'Download Range (Excel)'}
          </button>
        </div>

        <div className="text-xs opacity-60">
          Tip: if Firestore asks for an index when exporting a range, it will show a link to create it automatically.
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {Header}
      {Form}
      {Exports}

      <div className="flex items-center justify-between">
        <div className="text-lg font-semibold">Monthly logs — {monthLabel(selectedMonth)}</div>
        <div className="text-sm opacity-70">{loading ? 'Loading…' : `${monthTransfers.length} total transfer(s)`}</div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        <Section title="FOOD" rows={byCategory.FOOD} />
        <Section title="BEER" rows={byCategory.BEER} />
        <Section title="WINE" rows={byCategory.WINE} />
        <Section title="LIQUOR" rows={byCategory.LIQUOR} />
      </div>
    </div>
  );
}
