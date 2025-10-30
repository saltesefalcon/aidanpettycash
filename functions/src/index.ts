// functions/src/index.ts
import { onRequest } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2/options";
import { defineSecret } from "firebase-functions/params";
import nodemailer from "nodemailer";

// Global defaults
setGlobalOptions({
  region: "us-central1",
  timeoutSeconds: 60,
  memory: "256MiB",
});

// Declare secrets (bound at deploy)
const SMTP_HOST = defineSecret("SMTP_HOST");
const SMTP_PORT = defineSecret("SMTP_PORT");
const SMTP_USER = defineSecret("SMTP_USER");
const SMTP_PASS = defineSecret("SMTP_PASS");
const SMTP_FROM = defineSecret("SMTP_FROM");
const ACCOUNTING_TO = defineSecret("ACCOUNTING_TO");

export const sendInvoice = onRequest(
  {
    secrets: [
      SMTP_HOST,
      SMTP_PORT,
      SMTP_USER,
      SMTP_PASS,
      SMTP_FROM,
      ACCOUNTING_TO,
    ],
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Use POST");
      return;
    }

    const {
      to,               // optional override list (comma-separated)
      subject,          // optional
      text,             // optional
      html,             // optional
      attachmentBase64, // optional base64 string
      filename,         // required if attachmentBase64 present
    } = req.body || {};

    const recipients =
      (to && String(to)) ||
      (process.env.ACCOUNTING_TO as string) ||
      "";

    if (!recipients) {
      res.status(400).json({ ok: false, error: "Missing recipients" });
      return;
    }

    // SMTP transport
    const port = Number(process.env.SMTP_PORT || 465);
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465, // true for 465, false otherwise
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const attachments: { filename: string; content: Buffer }[] = [];
    if (attachmentBase64 && filename) {
      attachments.push({
        filename,
        content: Buffer.from(String(attachmentBase64), "base64"),
      });
    }

    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: recipients,
      subject: subject || "Petty Cash: Invoice",
      text: text || undefined,
      html: html || undefined,
      attachments,
    });

    res.status(200).json({ ok: true });
  }
);
