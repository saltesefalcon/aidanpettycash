import 'server-only';

export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { FieldValue } from 'firebase-admin/firestore';

import { adminAuth, adminDb, adminBucket } from '@/lib/firebaseAdmin';
import { STORE_INFO } from '@/lib/stores';

const STORE_EMAILS: Record<string, string> = {
  tulia: 'accounts@tuliaosteria.com',
  prohibition: 'accounts@prohibitionsocialhouse.com',
  cesoir: 'accounts@cesoirbrasserie.com',
  beacon: 'accounts@beaconsocialhouse.com',
};

function bearerToken(req: Request) {
  const h = req.headers.get('authorization') || req.headers.get('Authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1] || '';
}

function toDateOnly(t: any) {
  const d = t?.toDate?.() ? t.toDate() : new Date(t);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

export async function POST(req: Request, ctx: { params: { storeId: string } }) {
  const storeId = (ctx.params.storeId || '').toLowerCase();

  let transferId = '';
  try {
    // Auth
    const token = bearerToken(req);
    if (!token) {
      return NextResponse.json({ ok: false, error: 'Missing Authorization bearer token' }, { status: 401 });
    }
    const decoded = await adminAuth.verifyIdToken(token);

    // Body
    const body = await req.json();
    transferId = String(body?.transferId || '');
    if (!transferId) {
      return NextResponse.json({ ok: false, error: 'Missing transferId' }, { status: 400 });
    }

    // Load transfer (ADMIN SDK → adminDb.collection(...) is valid)
    const snap = await adminDb.collection('transfers').doc(transferId).get();
    if (!snap.exists) {
      return NextResponse.json({ ok: false, error: 'Transfer not found' }, { status: 404 });
    }
    const t = snap.data() as any;

    // Basic guard: this API endpoint should be called using the FROM store
    if (String(t.fromStoreId || '').toLowerCase() !== storeId) {
      return NextResponse.json({ ok: false, error: 'Route storeId must match fromStoreId' }, { status: 403 });
    }

    const fromId = String(t.fromStoreId || '').toLowerCase();
    const toId = String(t.toStoreId || '').toLowerCase();

    const fromEmail = STORE_EMAILS[fromId];
    const toEmail = STORE_EMAILS[toId];
    if (!fromEmail || !toEmail) {
      return NextResponse.json({ ok: false, error: 'Missing store email mapping' }, { status: 500 });
    }

    const fromName = STORE_INFO[fromId]?.name || fromId;
    const toName = STORE_INFO[toId]?.name || toId;

    const dateStr = toDateOnly(t.date);
    const subject = `${fromName} to ${toName} Aidan Transfer ${dateStr}`;

    const outPath = String(t.invoiceOutStoragePath || '');
    const inPath = String(t.invoiceInStoragePath || '');
    if (!outPath || !inPath) {
      return NextResponse.json({ ok: false, error: 'Missing invoice storage paths on transfer' }, { status: 400 });
    }

    // Download PDFs as bytes (attachments)
    const [outBytes] = await adminBucket.file(outPath).download();
    const [inBytes] = await adminBucket.file(inPath).download();

    // SMTP (set env vars)
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const mailFrom = process.env.MAIL_FROM || process.env.SMTP_USER || 'no-reply@example.com';

    // Send OUT invoice to FROM store (negative)
    await transporter.sendMail({
      from: mailFrom,
      to: fromEmail,
      subject,
      text: `Attached: TRANSFER OUT (NEGATIVE) invoice for ${fromName} → ${toName} on ${dateStr}.`,
      attachments: [
        {
          filename: `${t.invoiceNumber || 'transfer'}-OUT.pdf`,
          content: outBytes,
          contentType: 'application/pdf',
        },
      ],
    });

    // Send IN invoice to TO store (positive)
    await transporter.sendMail({
      from: mailFrom,
      to: toEmail,
      subject,
      text: `Attached: TRANSFER IN (POSITIVE) invoice for ${fromName} → ${toName} on ${dateStr}.`,
      attachments: [
        {
          filename: `${t.invoiceNumber || 'transfer'}-IN.pdf`,
          content: inBytes,
          contentType: 'application/pdf',
        },
      ],
    });

    // Mark as sent
    await adminDb.collection('transfers').doc(transferId).update({
      email: {
        status: 'sent',
        sentAt: FieldValue.serverTimestamp(),
        to: [fromEmail, toEmail],
        subject,
      },
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: {
        uid: decoded.uid,
        email: decoded.email || null,
        name: (decoded as any).name || null,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[notify-transfer]', err);

    // Best-effort mark failed (don’t crash if it can’t update)
    try {
      if (transferId) {
        await adminDb.collection('transfers').doc(transferId).update({
          email: {
            status: 'failed',
            failedAt: FieldValue.serverTimestamp(),
            error: err?.message || String(err),
          },
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    } catch {}

    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}
