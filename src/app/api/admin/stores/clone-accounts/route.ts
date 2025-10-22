// src/app/api/admin/stores/clone-accounts/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import type { NextRequest } from "next/server";
import { adminDb } from "../../../../../lib/firebaseAdmin";

// 🔒 Temporarily lock this tool after seeding.
// Switch to a real owner check later.
async function ensureOwner(_req: NextRequest): Promise<boolean> {
  return false; // deny all for now
}

export async function GET() {
  return new Response(JSON.stringify({ ok: true, locked: true }), {
    headers: { "content-type": "application/json" },
  });
}

export async function POST(req: NextRequest) {
  if (!(await ensureOwner(req))) return new Response("Unauthorized", { status: 401 });
  // (left in place, but unreachable while locked)
  const body = await req.json().catch(() => ({}));
  const from: string = body.from;
  const to: string[] = Array.isArray(body.to) ? body.to : [];
  if (!from || to.length === 0) return new Response("Missing `from` or `to`", { status: 400 });

  const srcSnap = await adminDb.collection("stores").doc(from).collection("accounts").get();
  const srcDocs = srcSnap.docs;
  const results: { target: string; count: number }[] = [];
  for (const target of to) {
    const batch = adminDb.batch();
    for (const d of srcDocs) {
      batch.set(adminDb.collection("stores").doc(target).collection("accounts").doc(d.id), d.data());
    }
    await batch.commit();
    results.push({ target, count: srcDocs.length });
  }
  return new Response(JSON.stringify({ from, results }), {
    headers: { "content-type": "application/json" },
  });
}

