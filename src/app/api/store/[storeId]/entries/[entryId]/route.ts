// src/app/api/stores/[storeId]/entries/[entryId]/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import type { NextRequest } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { Timestamp, FieldValue } from "firebase-admin/firestore";

// TODO: lock with auth/roles in prod. Dev-open:
function allow() { return process.env.NODE_ENV !== "production"; }

export async function DELETE(_req: NextRequest, { params }: { params: { storeId: string, entryId: string } }) {
  if (!allow()) return new Response("Unauthorized", { status: 401 });
  const { storeId, entryId } = params;
  await adminDb.doc(`stores/${storeId}/entries/${entryId}`).delete();
  return new Response("ok");
}

export async function PATCH(req: NextRequest, { params }: { params: { storeId: string, entryId: string } }) {
  if (!allow()) return new Response("Unauthorized", { status: 401 });
  const { storeId, entryId } = params;

  const body = await req.json().catch(() => ({}));
  const updates: any = {};

  // Allowed fields
  if (typeof body.vendor === "string") updates.vendor = body.vendor.trim();
  if (typeof body.description === "string") updates.description = body.description.trim();
  if (typeof body.amount === "number") updates.amount = Math.max(0, Math.round((body.amount + Number.EPSILON) * 100) / 100);
  if (typeof body.hst === "number") updates.hst = Math.max(0, Math.round((body.hst + Number.EPSILON) * 100) / 100);
  if (typeof body.accountId === "string") updates.account = body.accountId;
  if (typeof body.accountName === "string") updates.accountName = body.accountName;
  if (typeof body.dept === "string") updates.dept = body.dept;

  // date + month
  if (typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    const d = new Date(`${body.date}T00:00:00`);
    updates.date = Timestamp.fromDate(d);
    updates.month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  // recompute net if amount/hst changed
  if ("amount" in updates || "hst" in updates) {
    const amount = "amount" in updates ? updates.amount : undefined;
    const hst    = "hst" in updates ? updates.hst : undefined;
    // If one is undefined, fetch current to compute net accurately
    if (amount === undefined || hst === undefined) {
      const snap = await adminDb.doc(`stores/${storeId}/entries/${entryId}`).get();
      const cur = snap.data() || {};
      const a = amount ?? Number(cur.amount || 0);
      const h = hst ?? Number(cur.hst || 0);
      updates.net = Math.max(0, Math.round(((a - h) + Number.EPSILON) * 100) / 100);
    } else {
      updates.net = Math.max(0, Math.round(((amount - hst) + Number.EPSILON) * 100) / 100);
    }
  }

  updates.updatedAt = FieldValue.serverTimestamp();

  await adminDb.doc(`stores/${storeId}/entries/${entryId}`).update(updates);
  return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
}
