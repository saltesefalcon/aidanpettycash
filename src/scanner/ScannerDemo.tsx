"use client";

import { useEffect, useRef, useState } from "react";
import {
  makeSinglePagePdfFromDataUrl,
  makeMultiPagePdfFromDataUrls,
} from "../lib/pdf/makePdf";

export default function ScannerDemo() {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // offscreen working canvases
  const workCanvasRef = useRef<HTMLCanvasElement | null>(null);      // raw frame
  const rotatedCanvasRef = useRef<HTMLCanvasElement | null>(null);   // rotated upright portrait

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [pages, setPages] = useState<string[]>([]); // each string = dataURL for one scanned page
  const [error, setError] = useState<string | null>(null);

  async function startCamera() {
    setError(null);
    try {
      // Request high-res landscape, camera is physically sideways.
      const media = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 3840 },
          height: { ideal: 2160 },
          frameRate: { ideal: 15 },
        },
        audio: false,
      });

      const track = media.getVideoTracks()[0];
      console.log("Track settings:", track.getSettings());
      console.log("Track capabilities:", track.getCapabilities?.());

      // Attempt to stabilize focus (many webcams ignore, that's OK)
      try {
        // @ts-expect-error browser-specific
        await track.applyConstraints({
          advanced: [{ focusMode: "continuous" }],
        });
      } catch (focusErr) {
        console.warn("Could not adjust focus constraints:", focusErr);
      }

      setStream(media);
      if (videoRef.current) {
        videoRef.current.srcObject = media;
        await videoRef.current.play();
      }
    } catch (e: any) {
      setError(e?.message ?? "Camera access failed");
    }
  }

  function stopCamera() {
    stream?.getTracks().forEach((t) => t.stop());
    setStream(null);
  }

  function capturePage() {
    if (
      !videoRef.current ||
      !workCanvasRef.current ||
      !rotatedCanvasRef.current
    )
      return;

    const v = videoRef.current;
    const work = workCanvasRef.current;
    const rotated = rotatedCanvasRef.current;

    // 1. draw raw camera frame to work canvas
    work.width = v.videoWidth;
    work.height = v.videoHeight;
    const wctx = work.getContext("2d");
    if (!wctx) return;
    wctx.drawImage(v, 0, 0, work.width, work.height);

    // 2. rotate 90deg clockwise into rotated canvas so document is upright portrait
    rotated.width = work.height;
    rotated.height = work.width;
    const rctx = rotated.getContext("2d");
    if (!rctx) return;
    rctx.save();
    rctx.translate(rotated.width, 0);
    rctx.rotate(Math.PI / 2);
    rctx.drawImage(work, 0, 0);
    rctx.restore();

    // 3. export high-quality JPEG data URL for this page
    const jpegDataUrl = rotated.toDataURL("image/jpeg", 0.95);

    // 4. store as a new page
    setPages((prev) => [...prev, jpegDataUrl]);
  }

  function removePage(idx: number) {
    setPages((prev) => prev.filter((_, i) => i !== idx));
  }

  async function downloadAllPagesAsPdf() {
    if (pages.length === 0) return;
    const blob = await makeMultiPagePdfFromDataUrls(pages);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "invoice-scan.pdf";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function downloadFirstPageOnly() {
    if (pages.length === 0) return;
    const blob = await makeSinglePagePdfFromDataUrl(pages[0]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "invoice-scan-single.pdf";
    a.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    // stop camera on unmount
    return () => {
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [stream]);

  // Styles
  const scanBoxStyle: React.CSSProperties = {
    width: "300px",
    height: "400px",
    background: "black",
    borderRadius: "8px",
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };

  // live video rotated 90deg so user sees the doc upright
  const videoStyle: React.CSSProperties = {
    maxWidth: "100%",
    maxHeight: "100%",
    objectFit: "contain",
    background: "black",
    transform: "rotate(90deg)",
  };

  const thumbStyle: React.CSSProperties = {
    width: "90px",
    height: "120px",
    borderRadius: "4px",
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
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 12 }}>
        Scanner Demo (Phase 0)
      </h1>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 24 }}>
        {/* Camera / capture */}
        <div
          style={{
            flex: "0 1 auto",
            minWidth: 340,
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            padding: 16,
          }}
        >
          <h2 style={{ fontWeight: 600, marginBottom: 12, color: "#1e293b" }}>
            Camera
          </h2>

          <div style={scanBoxStyle}>
            <video ref={videoRef} style={videoStyle} playsInline muted />
          </div>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              marginTop: 16,
            }}
          >
            {!stream ? (
              <button onClick={startCamera} style={btn("blue")}>
                Start Camera
              </button>
            ) : (
              <>
                <button onClick={capturePage} style={btn("green")}>
                  Capture Page
                </button>
                <button onClick={stopCamera} style={btn("gray")}>
                  Stop Camera
                </button>
              </>
            )}
          </div>

          {error && (
            <p style={{ color: "#dc2626", marginTop: 8 }}>{error}</p>
          )}
        </div>

        {/* Pages / preview */}
        <div
          style={{
            flex: "1 1 400px",
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            padding: 16,
            minWidth: 340,
          }}
        >
          <h2 style={{ fontWeight: 600, marginBottom: 12, color: "#1e293b" }}>
            Scanned Pages ({pages.length})
          </h2>

          {pages.length === 0 ? (
            <div
              style={{
                color: "#94a3b8",
                fontSize: 14,
                textAlign: "center",
                padding: 16,
                border: "1px solid #e5e7eb",
                borderRadius: 8,
                background: "#f8fafc",
              }}
            >
              No pages captured yet
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 16,
              }}
            >
              {pages.map((dataUrl, idx) => (
                <div
                  key={idx}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                  }}
                >
                  <div style={thumbStyle}>
                    <img
                      src={dataUrl}
                      alt={`Page ${idx + 1}`}
                      style={thumbImgStyle}
                    />
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "#475569",
                      marginTop: 4,
                    }}
                  >
                    Page {idx + 1}
                  </div>
                  <button
                    onClick={() => removePage(idx)}
                    style={{
                      ...btn("gray"),
                      padding: "4px 8px",
                      fontSize: 12,
                      marginTop: 4,
                    }}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              marginTop: 16,
            }}
          >
            <button onClick={() => setPages([])} style={btn("gray")}>
              Clear All
            </button>

            {pages.length > 0 && (
              <>
                <button
                  onClick={downloadFirstPageOnly}
                  style={btn("indigo")}
                >
                  Download First Page PDF
                </button>

                <button
                  onClick={downloadAllPagesAsPdf}
                  style={btn("blue")}
                >
                  Download All Pages as PDF
                </button>
              </>
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

function btn(color: "blue" | "green" | "gray" | "indigo") {
  const map: Record<string, string> = {
    blue: "#2563eb",
    green: "#059669",
    gray: "#e5e7eb",
    indigo: "#4f46e5",
  };
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
