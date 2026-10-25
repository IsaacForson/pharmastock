import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { adminDb } from "@/db";
import { messageLog } from "@/db/schema";
import { handleInbound } from "@/lib/worker/inbound";

/**
 * Africa's Talking callbacks (form-encoded). Inbound SMS: from, to, text, id. Delivery reports: id, status.
 * Africa's Talking doesn't sign callbacks, so set SMS_WEBHOOK_SECRET and register the URL with ?secret=… .
 */
export async function POST(req: Request) {
  const secret = process.env.SMS_WEBHOOK_SECRET;
  if (secret) {
    const got = new URL(req.url).searchParams.get("secret") ?? "";
    if (got.length !== secret.length || !timingSafeEqual(Buffer.from(got), Buffer.from(secret))) return new Response("Forbidden", { status: 403 });
  }
  const fd = await req.formData();
  const get = (k: string) => (typeof fd.get(k) === "string" ? (fd.get(k) as string) : "");
  const id = get("id");
  if (get("text") && get("from")) {
    try {
      await handleInbound({ channel: "sms", from: get("from"), text: get("text"), provider: "africastalking", providerId: id || null });
    } catch (e) {
      console.error("SMS inbound failed:", e);
    }
  } else if (id && get("status")) {
    const status = get("status") === "Success" ? "delivered" : ["Failed", "Rejected"].includes(get("status")) ? "failed" : null;
    if (status) await adminDb().update(messageLog).set({ status, ...(status === "failed" ? { error: get("failureReason") || "SMS delivery failed" } : {}) }).where(eq(messageLog.providerId, id));
  }
  return new Response("OK");
}
