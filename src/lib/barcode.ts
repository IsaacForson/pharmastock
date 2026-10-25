/**
 * Hand-written Code 128 encoder (SVG output) and EAN-13 check digits. Pure: safe in server and client code.
 */

/** Bar/space widths for Code 128 symbol values 0–106 (106 = stop, 7 elements). */
export const C128 = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];
const START_B = 104, START_C = 105, STOP = 106;

/**
 * Symbol values for `text` including start, checksum and stop. All-digit text of even length uses code set C (half
 * the width); everything else code set B (printable ASCII).
 * shortcut: no mid-symbol code-set switching, upgrade if long mixed codes need to fit narrow labels.
 */
export function code128Values(text: string): number[] {
  if (!text) throw new Error("Nothing to encode");
  let vals: number[];
  if (/^\d+$/.test(text) && text.length % 2 === 0) {
    vals = [START_C];
    for (let i = 0; i < text.length; i += 2) vals.push(Number(text.slice(i, i + 2)));
  } else {
    vals = [START_B];
    for (const ch of text) {
      const c = ch.charCodeAt(0);
      if (c < 32 || c > 126) throw new Error("Code 128 labels support plain letters, digits and symbols only");
      vals.push(c - 32);
    }
  }
  const check = vals.reduce((s, v, i) => s + v * (i || 1), 0) % 103;
  return [...vals, check, STOP];
}

/** Module widths (bar, space, bar, …) including the stop pattern's final bar. */
export const code128Modules = (text: string) => code128Values(text).flatMap((v) => [...C128[v]].map(Number));

/** SVG markup for a Code 128 barcode. Bars use currentColor; 10-module quiet zone on each side. */
export function code128Svg(text: string, o: { height?: number; moduleWidth?: number; showText?: boolean } = {}): string {
  const h = o.height ?? 40, mw = o.moduleWidth ?? 1.5, quiet = 10;
  const mods = code128Modules(text);
  const total = mods.reduce((a, b) => a + b, 0) + quiet * 2;
  const textH = o.showText === false ? 0 : 11;
  let x = quiet, rects = "";
  mods.forEach((w, i) => {
    if (i % 2 === 0) rects += `<rect x="${x * mw}" y="0" width="${w * mw}" height="${h}"/>`;
    x += w;
  });
  const label = textH ? `<text x="${(total * mw) / 2}" y="${h + 10}" text-anchor="middle" font-family="monospace" font-size="10">${escapeXml(text)}</text>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total * mw} ${h + textH}" width="${total * mw}" height="${h + textH}" fill="currentColor" role="img" aria-label="Barcode ${escapeXml(text)}">${rects}${label}</svg>`;
}

const escapeXml = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** EAN-13 / GTIN-13 check digit for the first 12 digits. */
export function ean13CheckDigit(first12: string): number {
  if (!/^\d{12}$/.test(first12)) throw new Error("Need 12 digits");
  const sum = [...first12].reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10;
}
export const isValidEan13 = (code: string) => /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);

/** Internal (in-store) EAN-13 in the GS1 restricted-circulation range 20…: "20" + 10-digit sequence + check digit. */
export function internalEan13(seq: number): string {
  const body = "20" + String(seq).padStart(10, "0");
  return body + ean13CheckDigit(body);
}
