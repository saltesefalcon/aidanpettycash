// src/app/api/store/[storeId]/notify-invoice/route.ts
import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { getAdminDb } from "@/lib/admin";

// TODO: Adjust these store IDs and email addresses to match your real setup.
// Keys are Firestore storeIds; inner keys are accountName strings exactly as
// they appear in entries.accountName (e.g. "5110 Purchases:Beer Purchases").
const ACCOUNT_EMAIL_RULES: Record<string, Record<string, string>> = {
  beacon: {
    "5110 Purchases:Beer Purchases": "accounts@beaconsocialhouse.com",
    "5120 Purchases:Food Purchases": "accounts@beaconsocialhouse.com",
    "5130 Purchases:Liquor Purchases": "accounts@beaconsocialhouse.com",
    "5160 Purchases:Wine Purchases": "accounts@beaconsocialhouse.com",
  },
  prohibition: {
    "5110 Purchases:Beer Purchases": "accounts@prohibitionsocialhouse.com",
    "5120 Purchases:Food Purchases": "accounts@prohibitionsocialhouse.com",
    "5130 Purchases:Liquor Purchases": "accounts@prohibitionsocialhouse.com",
    "5160 Purchases:Wine Purchases": "accounts@prohibitionsocialhouse.com",
  },
  tulia: {
    "5110 Purchases:Beer Purchases": "accounts@tuliaosteria.com",
    "5120 Purchases:Food Purchases": "accounts@tuliaosteria.com",
    "5130 Purchases:Liquor Purchases": "accounts@tuliaosteria.com",
    "5160 Purchases:Wine Purchases": "accounts@tuliaosteria.com",
  },
  cesoir: {
    "5110 Purchases:Beer Purchases": "accounts@cesoirbrasserie.com",
    "5120 Purchases:Food Purchases": "accounts@cesoirbrasserie.com",
    "5130 Purchases:Liquor Purchases": "accounts@cesoirbrasserie.com",
    "5160 Purchases:Wine Purchases": "accounts@cesoirbrasserie.com",
  },
  // Add/remove stores/accounts as needed
};

// We create the transporter once per lambda cold start.
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === "true", // true for 465, false for 587
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function POST(
  req: NextRequest,
  { params }: any
) {
  const { storeId } = params;

  try {
    const body = await req.json().catch(() => ({}));
    const entryId = String(body.entryId || "").trim();
    if (!entryId) {
      return NextResponse.json(
        { ok: false, error: "Missing entryId in body" },
        { status: 400 }
      );
    }

    const db = getAdminDb();

    // Load the entry
    const entrySnap = await db
      .collection("stores")
      .doc(storeId)
      .collection("entries")
      .doc(entryId)
      .get();

    if (!entrySnap.exists) {
      return NextResponse.json(
        { ok: false, error: "Entry not found" },
        { status: 404 }
      );
    }

    const entry = entrySnap.data() as any;
    const accountName: string =
      (entry.accountName || entry.account || "").toString().trim();
    const invoiceUrl: string = (entry.invoiceUrl || "").toString().trim();

    if (!accountName || !invoiceUrl) {
      // Nothing to do if no account or no invoice attached
      return NextResponse.json({
        ok: false,
        skipped: true,
        reason: "Missing accountName or invoiceUrl",
      });
    }

    // Resolve store config + email target
    const storeRules = ACCOUNT_EMAIL_RULES[storeId] || {};
    const to = storeRules[accountName];

    if (!to) {
      // This account is not configured to auto-email; silently skip
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "No email rule for account",
        accountName,
      });
    }

    // Optional: load store name for nicer subject
    const storeSnap = await db.collection("stores").doc(storeId).get();
    const storeName =
      (storeSnap.data()?.name as string) || storeId || "Petty Cash";

    // Try to get a human-friendly date + description for the subject/body
    const date =
      typeof entry.date?.toDate === "function"
        ? entry.date.toDate()
        : entry.date
        ? new Date(entry.date)
        : null;
    const dateStr = date ? date.toISOString().slice(0, 10) : "";
    const vendor = (entry.vendor || "").toString();
    const description = (entry.description || "").toString();
    const amount = Number(entry.amount || 0).toFixed(2);

    const subject = `[${storeName}] Petty Cash Invoice – ${accountName} – ${dateStr}`;
    const plainBody = [
      `Store: ${storeName}`,
      `Account: ${accountName}`,
      `Date: ${dateStr || "n/a"}`,
      `Vendor: ${vendor || "n/a"}`,
      `Description: ${description || "n/a"}`,
      `Amount: $${amount}`,
      "",
      "The invoice PDF is attached.",
    ].join("\n");

    const htmlBody = plainBody.replace(/\n/g, "<br />");

    await transporter.sendMail({
      from: process.env.INVOICE_FROM_EMAIL || process.env.SMTP_USER,
      to,
      subject,
      text: plainBody,
      html: htmlBody,
      // Nodemailer can fetch from a URL directly; we don't have to read the bytes.
      attachments: [
        {
          filename:
            `${storeName.replace(/\s+/g, "_")}_${dateStr || "invoice"}.pdf`,
          path: invoiceUrl,
        },
      ],
    });

    return NextResponse.json({
      ok: true,
      sent: true,
      to,
      accountName,
    });
  } catch (err: any) {
    console.error("[notify-invoice] error", err);
    return NextResponse.json(
      { ok: false, error: err?.message || String(err) },
      { status: 500 }
    );
  }
}
