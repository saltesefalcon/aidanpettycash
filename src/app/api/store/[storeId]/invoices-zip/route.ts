// src/app/api/store/[storeId]/invoices-zip/route.ts
import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { getAdminDb, getAdminBucket } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safe(s: string, max = 80) {
  return (s || "")
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, max)
    .replace(/^_+|_+$/g, "");
}

function guessExt(urlOrName: string) {
  const u = (urlOrName || "").toLowerCase();
  if (u.includes(".pdf")) return ".pdf";
  if (u.includes(".jpg") || u.includes(".jpeg")) return ".jpg";
  if (u.includes(".png")) return ".png";
  return ".pdf"; // scanner default
}

/** Normalize a Storage URL (https or gs://) to a bucket object path. */
function objectPathFromUrl(url: string): string | null {
  if (!url) return null;

  // gs://<bucket>/<path>
  if (url.startsWith("gs://")) {
    try {
      return url.replace(/^gs:\/\/[^/]+\//, "");
    } catch {
      return null;
    }
  }

  // https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<encodedPath>?...
  const idx = url.indexOf("/o/");
  if (idx !== -1) {
    try {
      const after = url.slice(idx + 3);
      const untilQ = after.split("?")[0];
      return decodeURIComponent(untilQ);
    } catch {
      return null;
    }
  }

  // Already a plain path?
  return url.replace(/^https?:\/\//, "").includes("/")
    ? url.replace(/^[^/]+\/+/, "")
    : url;
}

export async function GET(req: NextRequest, context: any) {
  try {
    const db = getAdminDb();
    const bucket = getAdminBucket();

    const storeId = String(context?.params?.storeId || "").toLowerCase();
    const { searchParams } = new URL(req.url);
    const m = searchParams.get("m"); // YYYY-MM

    if (!m || !/^\d{4}-\d{2}$/.test(m)) {
      return NextResponse.json({ error: "Provide m=YYYY-MM" }, { status: 400 });
    }

    // Fetch entries for the month and collect invoice URLs
    const snap = await db
      .collection("stores")
      .doc(storeId)
      .collection("entries")
      .where("month", "==", m)
      .get();

    type Picked = {
      id: string;
      iso: string;
      vendor: string;
      amount: number;
      invoiceUrl?: string;
    };

    const items: Picked[] = [];
    snap.forEach((d) => {
      const x = d.data() as any;
      if (x?.deleted === true) return;

      const invoiceUrl =
        x.invoiceUrl || x.attachmentUrl || x.scanUrl || x.invoice?.url || x.attachment?.url;
      if (!invoiceUrl) return;

      const iso =
        x?.date?.toDate?.()?.toISOString?.()?.slice(0, 10) ||
        x?.isoDate ||
        "";

      items.push({
        id: d.id,
        iso,
        vendor: String(x.vendor ?? ""),
        amount: Number(x.amount || 0),
        invoiceUrl,
      });
    });

    if (!items.length) {
      return NextResponse.json({ error: "No invoices found for that month." }, { status: 404 });
    }

    // Build the ZIP in memory
    const zip = new JSZip();
    for (const it of items) {
      const objectPath = objectPathFromUrl(it.invoiceUrl!);
      if (!objectPath) continue;

      const ext = guessExt(it.invoiceUrl!);
      const fnameBase =
        `${safe(it.iso || m)}_${safe(it.vendor || "Vendor")}` +
        (it.amount ? `_${String(it.amount).replace(/[^\d.]/g, "")}` : "") +
        `_${safe(it.id, 12)}`;
      const fname = `${fnameBase}${ext}`;

      const [buf] = await bucket.file(objectPath).download();
      zip.file(fname, buf);
    }

    // JSZip -> Buffer -> Blob (avoids ArrayBuffer/SharedArrayBuffer union types)
    const nodeBuf: Buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const blob = new Blob([nodeBuf], { type: "application/zip" });

    const fnameZip = `invoices_${storeId}_${m}.zip`;
    const headers = new Headers({
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${fnameZip}"`,
      "Cache-Control": "no-store",
    });

    return new Response(blob, { status: 200, headers });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
