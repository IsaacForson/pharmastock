"use client";
import { Camera, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * USB/Bluetooth barcode scanners type the code fast and press Enter. Calls onCode for such bursts typed anywhere on the
 * page, except into a focused field that handles its own input (the field still receives the code). Human typing is
 * slower than ~40ms per key, so it never triggers this.
 */
export function useWedgeScanner(onCode: (code: string) => void, enabled = true) {
  const cb = useRef(onCode);
  useEffect(() => { cb.current = onCode; }, [onCode]);
  useEffect(() => {
    if (!enabled) return;
    let buf = "", last = 0;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const inField = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) && !el.dataset.scanPassthrough;
      const now = performance.now();
      if (now - last > 40) buf = "";
      last = now;
      if (e.key === "Enter") {
        if (buf.length >= 6 && !inField) { e.preventDefault(); cb.current(buf); }
        buf = "";
      } else if (e.key.length === 1) buf += e.key;
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [enabled]);
}

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };

/** Phone/tablet camera scanning: the browser's BarcodeDetector where available, ZXing otherwise. */
export function CameraScanner({ onCode, label = "Scan with camera", className }: { onCode: (code: string) => void; label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!open) return;
    let stop = () => {};
    let cancelled = false;
    (async () => {
      try {
        const W = window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector };
        if (W.BarcodeDetector) {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
          if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
          const v = video.current!;
          v.srcObject = stream;
          await v.play();
          const det = new W.BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "qr_code", "data_matrix"] });
          let raf = 0;
          const tick = async () => {
            const found = await det.detect(v).catch(() => []);
            if (found[0]?.rawValue) { onCode(found[0].rawValue); setOpen(false); return; }
            raf = requestAnimationFrame(tick);
          };
          raf = requestAnimationFrame(tick);
          stop = () => { cancelAnimationFrame(raf); stream.getTracks().forEach((t) => t.stop()); };
        } else {
          const { BrowserMultiFormatReader } = await import("@zxing/browser");
          const reader = new BrowserMultiFormatReader();
          const controls = await reader.decodeFromVideoDevice(undefined, video.current!, (res) => {
            if (res) { onCode(res.getText()); setOpen(false); }
          });
          if (cancelled) controls.stop();
          stop = () => controls.stop();
        }
      } catch (e) {
        setError((e as Error).name === "NotAllowedError" ? "Camera permission was refused." : "Couldn't start the camera on this device.");
      }
    })();
    return () => { cancelled = true; stop(); };
  }, [open, onCode]);

  return (
    <>
      <button type="button" onClick={() => { setError(null); setOpen(true); }} className={className ?? "inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 text-sm font-medium text-fg hover:bg-surface-3"}>
        <Camera className="h-4 w-4" aria-hidden /> {label}
      </button>
      {open && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-canvas/80 p-4 backdrop-blur" role="dialog" aria-modal="true" aria-label="Camera scanner">
          <div className="w-full max-w-md overflow-hidden rounded-3xl border border-line bg-solid shadow-panel">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm font-medium text-fg">Point the camera at the barcode</span>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close scanner" className="grid h-9 w-9 place-items-center rounded-xl text-muted hover:bg-surface-2"><X className="h-4 w-4" /></button>
            </div>
            {error ? <p className="px-4 pb-6 text-sm text-bad">{error}</p> : <video ref={video} className="aspect-[4/3] w-full bg-canvas object-cover" muted playsInline />}
          </div>
        </div>
      )}
    </>
  );
}
