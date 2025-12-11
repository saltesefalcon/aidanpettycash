// src/app/api/store/[storeId]/notify-invoice/route.ts
import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { getAdminDb } from "@/lib/admin";

// Take something like "5130 Purchases:Liquor Purchases"
// and return just "Liquor Purchases" for the email subject.
function accountLabelForSubject(raw: string | undefined): string {
  if (!raw) return "";
  const trimmed = raw.trim();

  // Prefer the part after the last ":" (e.g. "Liquor Purchases")
  const afterColon = trimmed.split(":").slice(-1)[0]?.trim();
  if (afterColon && afterColon !== trimmed) return afterColon;

  // Fallback: strip a leading account number + word like "Purchases"
  // e.g. "5130 Purchases Food" -> "Food"
  const stripped = trimmed.replace(/^\d+\s+\w+\s*/u, "").trim();
  return stripped || trimmed;
}

// Map storeId + accountName → target email address.
// Keys must match the Firestore storeIds (lowercase) and the accountName
// exactly as stored in entries.accountName (or entries.account).
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
  context: any
) {
  // Loosen the type for Next.js but then validate/narrow ourselves.
  const { storeId } = (context?.params ?? {}) as { storeId?: string };

  if (!storeId) {
    return NextResponse.json(
      { ok: false, error: "Missing storeId in route params" },
      { status: 400 }
    );
  }

  // From here on, this is guaranteed to be a string.
  const storeIdResolved = storeId as string;
  const normalizedStoreId = storeIdResolved.toLowerCase();

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
      .doc(storeIdResolved)
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
    const accountName: string = (entry.accountName || entry.account || "")
      .toString()
      .trim();
    const invoiceUrl: string = (entry.invoiceUrl || "")
      .toString()
      .trim();

    if (!accountName || !invoiceUrl) {
      // Nothing to do if no account or no invoice attached
      return NextResponse.json({
        ok: false,
        skipped: true,
        reason: "Missing accountName or invoiceUrl",
      });
    }

    // Resolve store config + email target
    const storeRules = ACCOUNT_EMAIL_RULES[normalizedStoreId] || {};

    // Try exact match first
    let to = storeRules[accountName];

    // Fuzzy match: ignore case/extra spaces
    if (!to) {
      const normalize = (s: string) =>
        s.replace(/\s+/g, " ").trim().toLowerCase();
      const target = normalize(accountName);
      for (const [key, email] of Object.entries(storeRules)) {
        if (normalize(key) === target) {
          to = email;
          break;
        }
      }
    }

    if (!to) {
      // This account is not configured to auto-email; silently skip
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "No email rule for account",
        storeId: storeIdResolved,
        accountName,
      });
    }

    // Optional: load store name for nicer body (subject will be generic per your spec)
    const storeSnap = await db.collection("stores").doc(storeIdResolved).get();
    const storeName =
      ((storeSnap.data()?.name as string) ||
        storeIdResolved ||
        "Petty Cash"
      ).toString();

    // Try to get a human-friendly date + description for the body
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

    // Build subject exactly as requested:
    // "New Notch Petty Cash Invoice 2025-12-11 Liquor Purchases"
    const shortAccount = accountLabelForSubject(accountName);
    const subject = `New Notch Petty Cash Invoice ${dateStr || ""} ${
      shortAccount || ""
    }`.trim();

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
          filename: `${
            storeName.replace(/\s+/g, "_") || "pettycash"
          }_${dateStr || "invoice"}.pdf`,
          path: invoiceUrl,
        },
      ],
    });

    return NextResponse.json({
      ok: true,
      sent: true,
      to,
      accountName,
      storeId: storeIdResolved,
      subject,
    });
  } catch (err: any) {
    console.error("[notify-invoice] error", err);
    return NextResponse.json(
      { ok: false, error: err?.message || String(err) },
      { status: 500 }
    );
  }
}
