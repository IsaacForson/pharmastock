import { ImageResponse } from "next/og";
import { TRIAL_DAYS } from "@/lib/plans";

// ImageResponse can't read CSS variables, so the dark Aurora OS token values are inlined here (keep in sync with globals.css).
const C = { canvas: "#06070c", fg: "#eef0fb", muted: "#9aa0bb", line: "rgba(255,255,255,0.10)", accent: "#8b7bff", accent2: "#2ee6f5", accent3: "#f472d0" };

export const alt = "PharmaStock — Stop throwing away expired medicine";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72,
          color: C.fg, fontFamily: "sans-serif", backgroundColor: C.canvas,
          backgroundImage: `radial-gradient(circle at 15% 0%, rgba(139,123,255,0.45), transparent 50%), radial-gradient(circle at 95% 15%, rgba(46,230,245,0.28), transparent 45%), radial-gradient(circle at 60% 120%, rgba(244,114,208,0.22), transparent 50%)`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ width: 64, height: 64, borderRadius: 18, display: "flex", alignItems: "center", justifyContent: "center", backgroundImage: `linear-gradient(135deg, ${C.accent2} -10%, ${C.accent} 55%, ${C.accent3} 130%)` }}>
            <svg viewBox="0 0 64 64" width="32" height="32"><path fill="#ffffff" d="M23 6h18v17h17v18H41v17H23V41H6V23h17z" /></svg>
          </div>
          <span style={{ fontSize: 34, fontWeight: 600, letterSpacing: -1 }}>PharmaStock</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 76, fontWeight: 700, letterSpacing: -4, lineHeight: 1.02 }}>Stop throwing away</div>
          <div style={{ display: "flex", fontSize: 76, fontWeight: 700, letterSpacing: -4, lineHeight: 1.02, backgroundImage: `linear-gradient(90deg, ${C.accent2}, ${C.accent} 50%, ${C.accent3})`, backgroundClip: "text", color: "transparent" }}>
            expired medicine.
          </div>
          <div style={{ display: "flex", marginTop: 28, fontSize: 30, color: C.muted, maxWidth: 900 }}>
            Expiry alerts 90 days early, FEFO at the counter and reorder lists — pharmacy POS for Ghana, Nigeria &amp; Kenya.
          </div>
        </div>

        <div style={{ display: "flex", gap: 14, fontSize: 22, color: C.muted }}>
          {[`${TRIAL_DAYS}-day free trial`, "Till works offline", "Free data export"].map((t) => (
            <div key={t} style={{ display: "flex", padding: "10px 20px", borderRadius: 999, border: `1px solid ${C.line}`, backgroundColor: "rgba(255,255,255,0.04)" }}>{t}</div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
