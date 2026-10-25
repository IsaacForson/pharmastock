/**
 * Receipt data shared by the printed page, the till (online and offline) and ESC/POS printing. Pure: no database, safe
 * in the browser. The server builds ReceiptData from a sale (sales/data.ts); the offline till builds it from its cart.
 */
import { EscPos, wrap } from "./escpos";
import { dateTime, money } from "./format";

export type ReceiptLine = {
  description: string; qty: number; unitName: string; unitPriceMinor: number; discountMinor: number; totalMinor: number;
  medicine: boolean; schedule: string; batches: { batchNo: string; expiry: string | null }[]; returnedQty?: number;
};

export type ReceiptData = {
  pharmacy: {
    name: string; branch: string | null; address: string | null; phone: string | null; licenceNo: string | null; taxId: string | null;
    letterhead: string | null; footer: string | null; labelWarning: string; taxName: string; taxInclusive: boolean;
  };
  currency: string; timezone: string;
  saleNo: string; receiptNo: string | null; soldAt: string; offline: boolean; status: string;
  cashier: string | null; pharmacist: string | null; pharmacistRegNo: string | null;
  customer: { name: string; customerNo: string; balanceMinor: number; points: number } | null;
  rxNo: string | null;
  lines: ReceiptLine[];
  subtotalMinor: number; discountMinor: number; taxMinor: number; totalMinor: number;
  payer: { name: string; memberNo: string | null; portionMinor: number } | null;
  payments: { method: string; amountMinor: number; reference: string | null }[];
  changeMinor: number; creditMinor: number;
  loyalty: { earned: number; redeemed: number } | null;
  /** Public link to this receipt (QR on paper). */
  link: string | null;
};

export const METHOD_LABEL: Record<string, string> = {
  cash: "Cash", mobile_money: "Mobile money", card: "Card", bank: "Bank transfer", insurance: "Insurance", credit: "On account", loyalty: "Loyalty points",
};

/** Medicines (anything with a schedule other than non-drug) show batch and expiry on the receipt. */
export const isMedicine = (schedule: string) => schedule !== "non_drug";

export const fmtQty = (l: Pick<ReceiptLine, "qty" | "unitName">) => `${l.qty} x ${l.unitName}`;

/** The receipt as plain text lines for a printer `width` characters wide (42 at 80mm, 32 at 58mm). */
export function receiptLines(d: ReceiptData, width = 42): { text: string; style?: "title" | "bold" | "center" }[] {
  const m = (v: number) => money(v, d.currency);
  const out: { text: string; style?: "title" | "bold" | "center" }[] = [];
  const row = (l: string, r: string) => {
    const room = Math.max(0, width - r.length - 1);
    return (l.length > room ? l.slice(0, room) : l).padEnd(width - r.length) + r;
  };
  const push = (text: string, style?: "title" | "bold" | "center") => out.push({ text, style });
  push(d.pharmacy.name, "title");
  for (const l of [d.pharmacy.branch, d.pharmacy.letterhead, d.pharmacy.address, d.pharmacy.phone].filter(Boolean) as string[]) for (const w of wrap(l, width)) push(w, "center");
  if (d.pharmacy.licenceNo) push(`Licence ${d.pharmacy.licenceNo}`, "center");
  if (d.pharmacy.taxId) push(`TIN ${d.pharmacy.taxId}`, "center");
  push("-".repeat(width));
  push(row(`Sale ${d.saleNo}`, dateTime(d.soldAt, d.timezone, { dateStyle: "short", timeStyle: "short" })));
  if (d.receiptNo) push(`Receipt ${d.receiptNo}`);
  if (d.offline) push("Sold offline");
  if (d.status === "voided") push("*** VOIDED ***", "bold");
  if (d.customer) push(`Customer: ${d.customer.name} (${d.customer.customerNo})`);
  if (d.rxNo) push(`Prescription ${d.rxNo}`);
  push("-".repeat(width));
  for (const l of d.lines) {
    for (const w of wrap(l.description, width)) push(w, "bold");
    push(row(`  ${fmtQty(l)} @ ${m(l.unitPriceMinor)}`, m(l.totalMinor)));
    if (l.discountMinor) push(`  less ${m(l.discountMinor)}`);
    if (l.medicine) for (const b of l.batches) push(`  Batch ${b.batchNo || "-"}${b.expiry ? `  Exp ${b.expiry}` : ""}`);
  }
  push("-".repeat(width));
  push(row("Subtotal", m(d.subtotalMinor)));
  if (d.discountMinor) push(row("Discount", `-${m(d.discountMinor)}`));
  push(row(`${d.pharmacy.taxName}${d.pharmacy.taxInclusive ? " (incl.)" : ""}`, m(d.taxMinor)));
  push(row("TOTAL", m(d.totalMinor)), "bold");
  if (d.payer) push(row(`${d.payer.name}${d.payer.memberNo ? ` #${d.payer.memberNo}` : ""}`, `-${m(d.payer.portionMinor)}`));
  for (const p of d.payments) push(row(`${METHOD_LABEL[p.method] ?? p.method}${p.reference ? ` ${p.reference}` : ""}`, m(p.amountMinor)));
  if (d.creditMinor) push(row("On account", m(d.creditMinor)));
  if (d.changeMinor) push(row("Change", m(d.changeMinor)), "bold");
  if (d.customer && d.customer.balanceMinor) push(row("Account balance", m(d.customer.balanceMinor)));
  if (d.loyalty && (d.loyalty.earned || d.loyalty.redeemed)) {
    push(row("Points earned / used", `${d.loyalty.earned} / ${d.loyalty.redeemed}`));
    if (d.customer) push(row("Points balance", String(d.customer.points)));
  }
  push("-".repeat(width));
  if (d.cashier) push(`Served by ${d.cashier}`);
  if (d.pharmacist) push(`Pharmacist ${d.pharmacist}${d.pharmacistRegNo ? ` (${d.pharmacistRegNo})` : ""}`);
  if (d.lines.some((l) => l.medicine)) for (const w of wrap(d.pharmacy.labelWarning, width)) push(w, "center");
  for (const w of wrap(d.pharmacy.footer || "Thank you. Get well soon.", width)) push(w, "center");
  return out;
}

/** ESC/POS bytes for a receipt, with a QR code of the public link when there is one. */
export function receiptEscpos(d: ReceiptData, width = 42, opts: { drawer?: boolean } = {}): Uint8Array {
  const p = new EscPos().init();
  for (const l of receiptLines(d, width)) {
    if (l.style === "title") p.align("center").bold().size(1, 2).line(l.text).size(1, 1).bold(false).align("left");
    else if (l.style === "center") p.align("center").line(l.text).align("left");
    else if (l.style === "bold") p.bold().line(l.text).bold(false);
    else p.line(l.text);
  }
  if (d.link) p.feed().align("center").qr(d.link, width > 32 ? 6 : 4).line("Scan for your receipt").align("left");
  p.feed(3).cut();
  if (opts.drawer) p.drawer();
  return p.bytes();
}

/** WhatsApp share text (used with wa.me when no customer is attached, or offline). */
export function receiptShareText(d: ReceiptData) {
  const m = (v: number) => money(v, d.currency);
  return [
    `${d.pharmacy.name} receipt ${d.saleNo}`,
    ...d.lines.map((l) => `${l.description} ${fmtQty(l)}: ${m(l.totalMinor)}`),
    `Total ${m(d.totalMinor)}`,
    d.link ? `View: ${d.link}` : null,
  ].filter(Boolean).join("\n");
}
