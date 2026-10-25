/**
 * Minimal ESC/POS encoder for 58/80mm thermal receipt printers (Epson-compatible command set, which nearly every cheap
 * printer in our markets speaks). Pure: builds bytes only; sending them (WebUSB / Web Serial) is the till's job.
 */

const ESC = 0x1b, GS = 0x1d, LF = 0x0a;

/** Printers use a single-byte code page: fold accents, map common currency signs, replace anything else with "?". */
export function toAscii(s: string): string {
  return s
    .replace(/₵/g, "C").replace(/₦/g, "N").replace(/€/g, "EUR").replace(/£/g, "GBP")
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/ | /g, " ")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7e\n]/g, "?");
}

export class EscPos {
  private b: number[] = [];

  private raw(...bytes: number[]) { this.b.push(...bytes); return this; }

  init() { return this.raw(ESC, 0x40); }
  align(a: "left" | "center" | "right") { return this.raw(ESC, 0x61, a === "left" ? 0 : a === "center" ? 1 : 2); }
  bold(on = true) { return this.raw(ESC, 0x45, on ? 1 : 0); }
  /** Character magnification 1–8 in each direction. */
  size(w = 1, h = 1) {
    const c = (n: number) => Math.min(8, Math.max(1, Math.round(n))) - 1;
    return this.raw(GS, 0x21, (c(w) << 4) | c(h));
  }
  text(s: string) {
    for (const ch of toAscii(s)) this.b.push(ch.charCodeAt(0));
    return this;
  }
  line(s = "") { return this.text(s).raw(LF); }
  feed(n = 1) { for (let i = 0; i < n; i++) this.raw(LF); return this; }
  rule(width = 42, ch = "-") { return this.line(ch.repeat(width)); }
  /** Left text and right text on one line, padded to width (left is cut if needed). */
  row(left: string, right: string, width = 42) { return this.line(padRow(toAscii(left), toAscii(right), width)); }
  /** QR code (model 2). size = module size 1–16; error correction M. */
  qr(data: string, size = 6) {
    const d = [...new TextEncoder().encode(data)];
    const len = d.length + 3;
    return this
      .raw(GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0) // model 2
      .raw(GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, Math.min(16, Math.max(1, size))) // module size
      .raw(GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31) // error correction M
      .raw(GS, 0x28, 0x6b, len & 0xff, (len >> 8) & 0xff, 0x31, 0x50, 0x30, ...d) // store
      .raw(GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30); // print
  }
  /** Feed past the tear bar and partial cut. */
  cut() { return this.raw(GS, 0x56, 0x42, 0x03); }
  /** Kick the cash drawer on pin 2. */
  drawer() { return this.raw(ESC, 0x70, 0, 0x19, 0xfa); }
  bytes() { return Uint8Array.from(this.b); }
}

export function padRow(left: string, right: string, width: number) {
  const room = Math.max(0, width - right.length - 1);
  const l = left.length > room ? left.slice(0, room) : left;
  return l + " ".repeat(Math.max(1, width - l.length - right.length)) + right;
}

/** Word-wraps text to the printer width. */
export function wrap(s: string, width: number): string[] {
  const out: string[] = [];
  for (const para of s.split("\n")) {
    let cur = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (!cur) cur = word;
      else if ((cur + " " + word).length <= width) cur += " " + word;
      else { out.push(cur); cur = word; }
      while (cur.length > width) { out.push(cur.slice(0, width)); cur = cur.slice(width); }
    }
    out.push(cur);
  }
  return out;
}
