// src/lib/pdf/makePdf.ts
import { PDFDocument } from "pdf-lib";

/**
 * Build a multi-page PDF from image data URLs (png/jpg).
 * Returns a Blob you can upload to Firebase Storage.
 */
export async function makeMultiPagePdfFromDataUrls(
  pages: string[]
): Promise<Blob> {
  const pdf = await PDFDocument.create();

  for (const dataUrl of pages) {
    const bytes = dataUrlToBytes(dataUrl); // Uint8Array

    // Detect PNG vs JPG by MIME in the data URL
    const isPng = dataUrl.startsWith("data:image/png");
    const image = isPng ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);

    // Use the image’s native pixel size for a crisp page
    const page = pdf.addPage([image.width, image.height]);
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: image.width,
      height: image.height,
    });
  }

  // pdf.save() -> Uint8Array. Copy into a fresh ArrayBuffer (not SAB) for Blob.
  const u8 = await pdf.save();
  const ab = new ArrayBuffer(u8.byteLength);
  new Uint8Array(ab).set(u8);
  return new Blob([ab], { type: "application/pdf" });
}

/**
 * Convert a data: URL to raw bytes (Uint8Array).
 * Works in the browser and (if needed) during SSR with a Buffer fallback.
 */
function dataUrlToBytes(dataUrl: string): Uint8Array {
  if (!dataUrl.startsWith("data:")) {
    throw new Error("Expected a data: URL");
  }
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("Malformed data: URL");

  const meta = dataUrl.slice(5, comma); // after "data:"
  const isBase64 = /;base64/i.test(meta);
  const payload = dataUrl.slice(comma + 1);

  if (isBase64) {
    if (typeof atob === "function") {
      const bin = atob(payload);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    const NodeBuffer = (globalThis as any).Buffer;
    if (NodeBuffer?.from) {
      const buf = NodeBuffer.from(payload, "base64");
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }
    throw new Error("Base64 decoder not available in this environment");
  }

  // URL-encoded (rare for images)
  const decoded = decodeURIComponent(payload);
  return new TextEncoder().encode(decoded);
}
