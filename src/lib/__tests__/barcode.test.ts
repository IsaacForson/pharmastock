import { describe, expect, it } from "vitest";
import { C128, code128Svg, code128Values, ean13CheckDigit, internalEan13, isValidEan13 } from "@/lib/barcode";

describe("code 128", () => {
  it("has 107 well-formed patterns", () => {
    expect(C128).toHaveLength(107);
    C128.forEach((p, i) => expect([...p].reduce((s, d) => s + Number(d), 0)).toBe(i === 106 ? 13 : 11));
  });
  it("computes the checksum (weighted sum mod 103)", () => {
    const v = code128Values("PJJ123C");
    expect(v[0]).toBe(104);
    expect(v.at(-2)).toBe(879 % 103); // 104 + 48·1 + 42·2 + 42·3 + 17·4 + 18·5 + 19·6 + 35·7
    expect(v.at(-1)).toBe(106);
  });
  it("uses code set C for even-length digits", () => {
    expect(code128Values("2000000000017").at(0)).toBe(104); // odd length → B
    expect(code128Values("12345678")).toEqual([105, 12, 34, 56, 78, (105 + 12 + 34 * 2 + 56 * 3 + 78 * 4) % 103, 106]);
  });
  it("renders SVG and escapes text", () => {
    const svg = code128Svg("A<1");
    expect(svg).toMatch(/^<svg/);
    expect(svg).toContain("&#60;");
    expect(() => code128Values("é")).toThrow();
  });
});

describe("ean-13", () => {
  it("validates check digits", () => {
    expect(ean13CheckDigit("400638133393")).toBe(1);
    expect(isValidEan13("4006381333931")).toBe(true);
    expect(isValidEan13("4006381333932")).toBe(false);
    expect(isValidEan13("123")).toBe(false);
  });
  it("makes internal codes in the 20 range", () => {
    const c = internalEan13(42);
    expect(c).toMatch(/^200000000042\d$/);
    expect(isValidEan13(c)).toBe(true);
  });
});
