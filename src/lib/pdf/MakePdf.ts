import { jsPDF } from "jspdf";

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = dataUrl;
  });
}

// Single-page (for testing)
export async function makeSinglePagePdfFromDataUrl(dataUrl: string): Promise<Blob> {
  const img = await loadImage(dataUrl);
  const orientation =
    img.naturalWidth >= img.naturalHeight ? "landscape" : "portrait";

  const pdf = new jsPDF({
    unit: "pt",
    format: "letter",
    orientation,
    compress: true,
  });

  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();

  const margin = 24;
  const maxW = pageW - margin * 2;
  const maxH = pageH - margin * 2;

  const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
  const drawW = img.naturalWidth * scale;
  const drawH = img.naturalHeight * scale;

  const x = margin + (maxW - drawW) / 2;
  const y = margin + (maxH - drawH) / 2;

  pdf.addImage(dataUrl, "JPEG", x, y, drawW, drawH);

  return pdf.output("blob");
}

// Multi-page final PDF
export async function makeMultiPagePdfFromDataUrls(
  dataUrls: string[]
): Promise<Blob> {
  if (dataUrls.length === 0) {
    throw new Error("No pages to export");
  }

  const pdf = new jsPDF({
    unit: "pt",
    format: "letter",
    orientation: "portrait",
    compress: true,
  });

  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 24;
  const maxW = pageW - margin * 2;
  const maxH = pageH - margin * 2;

  for (let i = 0; i < dataUrls.length; i++) {
    const dataUrl = dataUrls[i];
    const img = await loadImage(dataUrl);

    const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
    const drawW = img.naturalWidth * scale;
    const drawH = img.naturalHeight * scale;
    const x = margin + (maxW - drawW) / 2;
    const y = margin + (maxH - drawH) / 2;

    if (i === 0) {
      pdf.addImage(dataUrl, "JPEG", x, y, drawW, drawH);
    } else {
      pdf.addPage();
      pdf.addImage(dataUrl, "JPEG", x, y, drawW, drawH);
    }
  }

  return pdf.output("blob");
}
