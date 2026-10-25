import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Public receipt links: /r/<token>, where the token is the sale id plus an HMAC of it. Nothing else is in the link, and
 * the page shows only what is on the paper receipt.
 */
const secret = () => {
  const k = process.env.ENCRYPTION_KEY;
  if (!k) throw new Error("ENCRYPTION_KEY is not set");
  return createHmac("sha256", Buffer.from(k, "base64")).update("pharmastock:receipt-link:v1").digest();
};
const mac = (id: string) => createHmac("sha256", secret()).update(id).digest("base64url").slice(0, 22);

export function signReceipt(saleId: string) {
  return `${saleId.replace(/-/g, "")}.${mac(saleId)}`;
}

/** Sale id for a valid token, else null. */
export function verifyReceipt(token: string): string | null {
  const m = /^([0-9a-f]{32})\.([\w-]{22})$/.exec(token);
  if (!m) return null;
  const h = m[1];
  const id = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  const a = Buffer.from(mac(id)), b = Buffer.from(m[2]);
  return a.length === b.length && timingSafeEqual(a, b) ? id : null;
}

export const receiptUrl = (saleId: string) => `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/r/${signReceipt(saleId)}`;
