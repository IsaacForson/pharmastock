import { describe, expect, it } from "vitest";
import { receiptEscpos, receiptLines, receiptShareText, type ReceiptData } from "@/lib/receipt";

const d: ReceiptData = {
  pharmacy: { name: "Good Health Pharmacy", branch: "Osu", address: "1 Oxford St", phone: "+233200000000", licenceNo: "PC/123", taxId: null, letterhead: null, footer: null, labelWarning: "Keep out of reach of children.", taxName: "VAT", taxInclusive: true },
  currency: "GHS", timezone: "Africa/Accra", saleNo: "SL-000001", receiptNo: "RCT-000001", soldAt: "2026-10-25T10:00:00Z", offline: false, status: "completed",
  cashier: "Ama", pharmacist: "Kofi", pharmacistRegNo: "MPS1", customer: null, rxNo: null,
  lines: [
    { description: "Amoxicillin 500 mg", qty: 2, unitName: "strip", unitPriceMinor: 1000, discountMinor: 0, totalMinor: 2000, medicine: true, schedule: "pom", batches: [{ batchNo: "A1", expiry: "2027-01-01" }] },
    { description: "Cotton wool", qty: 1, unitName: "pack", unitPriceMinor: 500, discountMinor: 0, totalMinor: 500, medicine: false, schedule: "non_drug", batches: [{ batchNo: "", expiry: null }] },
  ],
  subtotalMinor: 2500, discountMinor: 0, taxMinor: 0, totalMinor: 2500, payer: null,
  payments: [{ method: "cash", amountMinor: 3000, reference: null }], changeMinor: 500, creditMinor: 0, loyalty: null, link: "https://x.test/r/abc",
};

describe("receipt", () => {
  it("lists batch and expiry for medicines only, and the label warning", () => {
    const text = receiptLines(d).map((l) => l.text);
    expect(text).toContain("  Batch A1  Exp 2027-01-01");
    expect(text.filter((l) => l.includes("Batch"))).toHaveLength(1);
    expect(text).toContain("Keep out of reach of children.");
    expect(text.some((l) => l.startsWith("Change") && l.endsWith("5.00"))).toBe(true);
    expect(text.every((l) => l.length <= 42)).toBe(true);
  });
  it("builds printer bytes that end with a cut and include the QR link", () => {
    const b = receiptEscpos(d);
    expect([...b.slice(-4)]).toEqual([0x1d, 0x56, 0x42, 0x03]);
    expect(new TextDecoder().decode(b)).toContain("https://x.test/r/abc");
  });
  it("makes WhatsApp share text", () => {
    expect(receiptShareText(d)).toContain("View: https://x.test/r/abc");
  });
});
