import { describe, expect, it } from "vitest";
import { EscPos, padRow, toAscii, wrap } from "@/lib/escpos";

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join(" ");

describe("escpos encoder", () => {
  it("encodes init, alignment, bold, text and cut", () => {
    const b = new EscPos().init().align("center").bold().line("Hi").bold(false).cut().bytes();
    expect(hex(b)).toBe("1b 40 1b 61 01 1b 45 01 48 69 0a 1b 45 00 1d 56 42 03");
  });
  it("encodes a QR code with the right store length", () => {
    const b = [...new EscPos().qr("abc", 5).bytes()];
    expect(b.slice(0, 9)).toEqual([0x1d, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0]);
    const store = b.indexOf(0x50) - 6; // GS ( k pL pH 31 50
    expect(b.slice(store, store + 8)).toEqual([0x1d, 0x28, 0x6b, 6, 0, 0x31, 0x50, 0x30]);
    expect(b.slice(store + 8, store + 11)).toEqual([0x61, 0x62, 0x63]);
    expect(b.slice(-8)).toEqual([0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30]);
  });
  it("folds non-ASCII text the printer can't show", () => {
    expect(toAscii("GH₵ 12.50 – café ₦")).toBe("GHC 12.50 - cafe N");
    expect(toAscii("💊")).toMatch(/^\?+$/);
  });
  it("pads rows and wraps long words", () => {
    expect(padRow("Total", "12.00", 12)).toBe("Total  12.00");
    expect(padRow("A very long item name", "9.99", 12)).toBe("A very  9.99");
    expect(wrap("Keep out of reach of children", 10)).toEqual(["Keep out", "of reach", "of", "children"]);
    expect(wrap("abcdefghijkl", 5)).toEqual(["abcde", "fghij", "kl"]);
  });
});
