// src/app/api/sendReceiptEmail/route.ts
import { NextResponse } from 'next/server';
import { STORE_INFO } from '@/lib/stores';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { storeId, subject, filename, pdfBase64 } = body || {};

  const info = STORE_INFO[storeId as keyof typeof STORE_INFO];
  const to = info?.accountingTo || 'missing-store@invalid.local';

  // Stub only: just log what would be sent.
  console.log('[sendReceiptEmail STUB]', {
    to,
    storeId,
    subject,
    filename,
    bytes: pdfBase64 ? pdfBase64.length : 0,
  });

  // When you’re ready to send for real, we’ll swap this body for nodemailer.
  return NextResponse.json({ ok: true, stub: true });
}
