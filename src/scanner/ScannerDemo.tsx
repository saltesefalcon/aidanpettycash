// src/scanner/ScannerDemo.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { makeMultiPagePdfFromDataUrls } from "@/lib/pdf/makePdf";
import "@/lib/firebase";

type FinishParams = {
  storeId: string;
  entryId: string;
  amount: number;
  department: string;
  category: string;
  dateISO: string; // YYYY-MM-DD
  nonce: string;   // ties this scan to the opener's request
};

// ---- tune these if you want smaller/larger output ----
const MAX_LONG_SIDE = 1700;    // px (1080×1920 becomes ~956×1700)
const JPEG_QUALITY  = 0.88;    // 0.8–0.9 is a good balance
const ENABLE_GRAYSCALE = false; // set true to drop color (smaller files)

export default function ScannerDemo() {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // ---- URL params from opener ----
  const search = useSearchParams();
  const storeId = (search.get("store") || "beacon").toLowerCase();
  const entryId = search.get("entry") || `TEST-${Date.now()}`;
  const dateISO = (() => {
    const s = search.get("date") || new Date().toISOString().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : new Date().toISOString().slice(0, 10);
  })();
  const department = (search.get("dept") || "FOH").toUpperCase();
  const category = search.get("category") || "Uncategorized";
  const amount = (() => {
    const n = parseFloat(search.get("amount") || "0");
    return Number.isFinite(n) && n >= 0 ? n : 0;
  })();
  const nonce = search.get("nonce") || "";

  const params: FinishParams = { storeId, entryId, amount, department, category, dateISO, nonce };

  // ---- State & canvases ----
  const workCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rotatedCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [liveSize, setLiveSize] = useState<string>("");
  const [pages, setPages] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [keepOpen, setKeepOpen] = useState(true); // keep camera window open after attach

  // Prefer external/high-res webcam when multiple exist
  async function pickBestVideoDeviceId(): Promise<string | undefined> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const vids = devices.filter((d) => d.kind === "videoinput");
    if (vids.length === 0) return undefined;

    const scored = vids
      .map((d) => {
        const label = (d.label || "").toLowerCase();
        let score = 0;
        if (label.includes("4k")) score += 4;
        if (label.includes("hd")) score += 2;
        if (label.includes("usb")) score += 1;
        if (label.includes("integrated") || label.includes("internal")) score -= 3;
        return { id: d.deviceId, score, label: d.label || "" };
      })
      .sort((a, b) => b.score - a.score);

    return (scored[0]?.id || vids[0].deviceId) ?? undefined;
  }

  async function startCamera() {
    setError(null);

    // Unlock permission so labels are visible
    let firstStream: MediaStream | null = null;
    try {
      firstStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    } catch (e: any) {
      setError(e?.message ?? "Camera access failed");
      return;
    } finally {
      firstStream?.getTracks().forEach((t) => t.stop());
    }

    // Choose the best device
    let deviceId: string | undefined;
    try {
      deviceId = await pickBestVideoDeviceId();
    } catch {}

    // Open HD stream with graceful fallback
    const trySets: MediaStreamConstraints[] = [
      { video: { deviceId: deviceId ? { exact: deviceId } : undefined, width: { exact: 1920 }, height: { exact: 1080 }, frameRate: { ideal: 15 } }, audio: false },
      { video: { deviceId: deviceId ? { exact: deviceId } : undefined, width: { ideal: 1920, min: 1280 }, height: { ideal: 1080, min: 720 }, frameRate: { ideal: 15 }, aspectRatio: 16 / 9 }, audio: false },
      { video: { deviceId: deviceId ? { exact: deviceId } : undefined, width: { ideal: 1280 }, height: { ideal: 720 }, aspectRatio: 16 / 9 }, audio: false },
      { video: true, audio: false },
    ];

    let media: MediaStream | null = null;
    let lastErr: any = null;
    for (const c of trySets) {
      try {
        media = await navigator.mediaDevices.getUserMedia(c);
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!media) {
      setError((lastErr as any)?.message ?? "Camera access failed");
      return;
    }

    const track = media.getVideoTracks()[0];

    // Optional post-start tuning (no-ops if not supported)
    try {
      const caps: any = typeof track.getCapabilities === "function" ? track.getCapabilities() : null;
      const adv: Record<string, any> = {};
      if (caps?.focusMode) {
        const modes = Array.isArray(caps.focusMode) ? caps.focusMode : [caps.focusMode];
        if (modes.includes("continuous")) adv.focusMode = "continuous";
      }
      if (caps?.exposureMode) {
        const modes = Array.isArray(caps.exposureMode) ? caps.exposureMode : [caps.exposureMode];
        if (modes.includes("continuous")) adv.exposureMode = "continuous";
      }
      if (caps?.whiteBalanceMode) {
        const modes = Array.isArray(caps.whiteBalanceMode) ? caps.whiteBalanceMode : [caps.whiteBalanceMode];
        if (modes.includes("continuous")) adv.whiteBalanceMode = "continuous";
      }
      if (Object.keys(adv).length) await track.applyConstraints({ advanced: [adv] } as any);
    } catch {}

    // Try to keep 720p–1080p
    try {
      await track.applyConstraints({
        width: { ideal: 1920, min: 1280 },
        height: { ideal: 1080, min: 720 },
        aspectRatio: 16 / 9,
      });
    } catch {}

    setStream(media);

    if (videoRef.current) {
      const v = videoRef.current;
      v.srcObject = media;
      const p = v.play();
      if (p && typeof (p as any).catch === "function") (p as Promise<void>).catch(() => {});
    }

    const settings = (track.getSettings?.() || {}) as MediaTrackSettings;
    if (settings.width && settings.height) setLiveSize(`${settings.width}×${settings.height}`);
  }

  function stopCamera() {
    stream?.getTracks().forEach((t) => t.stop());
    setStream(null);
  }

  // Downscale (+ optional grayscale) helper
  function toCompressedDataUrl(srcCanvas: HTMLCanvasElement): string {
    const w0 = srcCanvas.width;
    const h0 = srcCanvas.height;
    const long0 = Math.max(w0, h0);
    const scale = Math.min(1, MAX_LONG_SIDE / long0);
    const w = Math.round(w0 * scale);
    const h = Math.round(h0 * scale);

    const out = document.createElement("canvas");
    out.width = w; out.height = h;

    const ctx = out.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(srcCanvas, 0, 0, w, h);

    if (ENABLE_GRAYSCALE) {
      const img = ctx.getImageData(0, 0, w, h);
      const data = img.data;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const y = (r * 0.299 + g * 0.587 + b * 0.114) | 0;
        data[i] = data[i + 1] = data[i + 2] = y;
      }
      ctx.putImageData(img, 0, 0);
    }

    return out.toDataURL("image/jpeg", JPEG_QUALITY);
  }

  function capturePage() {
    if (!videoRef.current || !workCanvasRef.current || !rotatedCanvasRef.current) return;

    const v = videoRef.current;
    const work = workCanvasRef.current;
    const rotated = rotatedCanvasRef.current;

    // draw raw camera frame
    work.width = v.videoWidth;
    work.height = v.videoHeight;
    const wctx = work.getContext("2d");
    if (!wctx) return;
    wctx.drawImage(v, 0, 0, work.width, work.height);

    // rotate into portrait
    rotated.width = work.height;
    rotated.height = work.width;
    const rctx = rotated.getContext("2d");
    if (!rctx) return;
    rctx.save();
    rctx.translate(rotated.width, 0);
    rctx.rotate(Math.PI / 2);
    rctx.imageSmoothingEnabled = true;
    rctx.imageSmoothingQuality = "high";
    rctx.drawImage(work, 0, 0);
    rctx.restore();

    // compress (downscale + JPEG quality [+ optional grayscale])
    const jpegDataUrl = toCompressedDataUrl(rotated);

    setPages((prev) => [...prev, jpegDataUrl]);
  }

  async function finishAndUpload({
    storeId, entryId, amount, department, category, dateISO, nonce,
  }: FinishParams) {
    if (pages.length === 0) throw new Error("No pages captured");
    setBusy(true);
    try {
      const pdfBlob = await makeMultiPagePdfFromDataUrls(pages);

      const storage = getStorage();
      // deterministic object path => overwrites on re-scan
      const path = `pettycash/${storeId}/${entryId}/invoice.pdf`;
      const sref = ref(storage, path);
      await uploadBytes(sref, pdfBlob, { contentType: "application/pdf" });
      const url = await getDownloadURL(sref);
      const viewUrl = `${url}${url.includes("?") ? "&" : "?"}ts=${Date.now()}`;

      const payload = {
        type: "pc-scan-complete",
        storeId,
        entryId,
        url,
        viewUrl,
        nonce,
      };

      // deliver to opener and stash fallback
      try {
        window.opener?.postMessage(payload, window.location.origin);
      } catch {}
      try {
        localStorage.setItem("pettycash:lastScan", JSON.stringify(payload));
      } catch {}

      if (keepOpen) {
        // keep camera live, clear pages for the next scan
        setPages([]);
      } else {
        window.close();
      }
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, [stream]);

  // ---- styles ----
  const scanBoxStyle: React.CSSProperties = {
    width: "300px",
    height: "400px",
    background: "black",
    borderRadius: 8,
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };
  const videoStyle: React.CSSProperties = {
    maxWidth: "100%",
    maxHeight: "100%",
    objectFit: "contain",
    background: "black",
    transform: "rotate(90deg)",
  };
  const thumbStyle: React.CSSProperties = {
    width: 90,
    height: 120,
    borderRadius: 4,
    border: "1px solid #e5e7eb",
    overflow: "hidden",
    background: "#0f172a",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };
  const thumbImgStyle: React.CSSProperties = {
    maxWidth: "100%",
    maxHeight: "100%",
    objectFit: "contain",
    background: "black",
  };

  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 12 }}>Scanner</h1>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 24 }}>
        {/* Camera / capture */}
        <div style={{ flex: "0 1 auto", minWidth: 340, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: 16 }}>
          <h2 style={{ fontWeight: 600, marginBottom: 8, color: "#1e293b" }}>
            Camera {liveSize && <span style={{ marginLeft: 8, color: "#64748b", fontSize: 12 }}>• Live: {liveSize}</span>}
          </h2>

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <label style={{ fontSize: 13, color: "#334155" }}>
              <input
                type="checkbox"
                checked={keepOpen}
                onChange={(e) => setKeepOpen(e.target.checked)}
                style={{ marginRight: 6 }}
              />
              Keep window open after attach
            </label>
          </div>

          <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
            Tip: For multi-page receipts, capture all pages first, then click <b>Finish &amp; Attach</b>.
          </p>

          <div style={scanBoxStyle}>
            <video ref={videoRef} style={videoStyle} playsInline muted />
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
            {!stream ? (
              <button onClick={startCamera} style={btn("blue")}>Start Camera</button>
            ) : (
              <>
                <button onClick={capturePage} style={btn("green")}>Capture Page</button>
                <button onClick={stopCamera} style={btn("gray")}>Stop Camera</button>
              </>
            )}
          </div>

          {error && <p style={{ color: "#dc2626", marginTop: 8 }}>{error}</p>}
        </div>

        {/* Pages / preview */}
        <div style={{ flex: "1 1 400px", background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: 16, minWidth: 340 }}>
          <h2 style={{ fontWeight: 600, marginBottom: 12, color: "#1e293b" }}>
            Scanned Pages ({pages.length})
          </h2>

          {pages.length === 0 ? (
            <div style={{ color: "#94a3b8", fontSize: 14, textAlign: "center", padding: 16, border: "1px solid #e5e7eb", borderRadius: 8, background: "#f8fafc" }}>
              No pages captured yet
            </div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
              {pages.map((dataUrl, idx) => (
                <div key={idx} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <div style={thumbStyle}>
                    <img src={dataUrl} alt={`Page ${idx + 1}`} style={thumbImgStyle} />
                  </div>
                  <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>Page {idx + 1}</div>
                  <button onClick={() => setPages((p) => p.filter((_, i) => i !== idx))} style={{ ...btn("gray"), padding: "4px 8px", fontSize: 12, marginTop: 4 }}>
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16, alignItems: "center" }}>
            <button onClick={() => setPages([])} style={btn("gray")}>Clear All</button>

            {pages.length > 0 && (
              <button
                disabled={busy}
                onClick={async () => {
                  try {
                    await finishAndUpload(params);
                  } catch (e: any) {
                    alert("Finish failed: " + (e?.message || e));
                  }
                }}
                style={btn("green")}
              >
                {busy ? "Uploading…" : "Finish & Attach"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* hidden offscreen canvases */}
      <canvas ref={workCanvasRef} style={{ display: "none" }} />
      <canvas ref={rotatedCanvasRef} style={{ display: "none" }} />
    </div>
  );
}

function btn(color: "blue" | "green" | "gray") {
  const map: Record<string, string> = { blue: "#2563eb", green: "#059669", gray: "#e5e7eb" };
  const text = color === "gray" ? "#111827" : "#fff";
  return {
    padding: "8px 12px",
    borderRadius: 6,
    background: map[color],
    color: text,
    border: "none",
    cursor: "pointer",
    fontWeight: 600,
    fontSize: 14,
  } as React.CSSProperties;
}
