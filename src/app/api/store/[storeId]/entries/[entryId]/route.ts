// src/app/api/store/[storeId]/entries/[entryId]/route.ts
// (If your folder is currently "stores", keep it consistent across the app;
// the code below works either way—only the folder name matters.)

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import type { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';

// TODO: add real auth/role checks for production.
function allow() {
  return process.env.NODE_ENV !== 'production';
}

// NOTE: do not type the 2nd arg; Next 15 validates its shape.
export async function DELETE(_req: NextRequest, { params }: any) {
  if (!allow()) return new Response('Unauthorized', { status: 401 });

  const { storeId, entryId } = params as { storeId: string; entryId: string };
  await adminDb.doc(`stores/${storeId}/entries/${entryId}`).delete();

  return new Response('ok', { status: 200 });
}

// NOTE: do not type the 2nd arg; Next 15 validates its shape.
export async function PATCH(req: NextRequest, { params }: any) {
  if (!allow()) return new Response('Unauthorized', { status: 401 });

  const { storeId, entryId } = params as { storeId: string; entryId: string };

  const body = await req.json().catch(() => ({} as Record<string, unknown>));

  const updates: Record<string, unknown> = {};

  // Allowed fields
  if (typeof body.vendor === 'string') updates.vendor = body.vendor.trim();
  if (typeof body.description === 'string') updates.description = body.description.trim();
  if (typeof body.amount === 'number') {
    const amt = Math.max(0, Math.round((body.amount + Number.EPSILON) * 100) / 100);
    updates.amount = amt;
  }
  if (typeof body.hst === 'number') {
    const h = Math.max(0, Math.round((body.hst + Number.EPSILON) * 100) / 100);
    updates.hst = h;
  }
  if (typeof body.accountId === 'string') updates.account = body.accountId;
  if (typeof body.accountName === 'string') updates.accountName = body.accountName;
  if (typeof body.dept === 'string') updates.dept = body.dept;

  // date + month
  if (typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    const d = new Date(`${body.date}T00:00:00`);
    updates.date = Timestamp.fromDate(d);
    updates.month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  // recompute net if amount/hst changed
  if ('amount' in updates || 'hst' in updates) {
    const snap = await adminDb.doc(`stores/${storeId}/entries/${entryId}`).get();
    const cur = (snap.data() ?? {}) as { amount?: number; hst?: number };

    const amount = ('amount' in updates ? (updates.amount as number) : cur.amount) ?? 0;
    const hst = ('hst' in updates ? (updates.hst as number) : cur.hst) ?? 0;

    const net = Math.max(0, Math.round(((amount - hst) + Number.EPSILON) * 100) / 100);
    updates.net = net;
  }

  updates.updatedAt = FieldValue.serverTimestamp();

  await adminDb.doc(`stores/${storeId}/entries/${entryId}`).update(updates);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

