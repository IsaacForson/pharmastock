import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { adminDb } from "@/db";
import { messageLog } from "@/db/schema";
import { handleInbound } from "@/lib/worker/inbound";

export function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const token = process.env.WHATSAPP_VERIFY_TOKEN;
  if (token && q.get("hub.mode") === "subscribe" && q.get("hub.verify_token") === token) return new Response(q.get("hub.challenge") ?? "");
  return new Response("Forbidden", { status: 403 });
}

const RANK: Record<string, number> = { queued: 0, sent: 1, delivered: 2, read: 3 };

type WaMessage = { from: string; id: string; type: string; text?: { body: string }; button?: { text: string }; interactive?: { button_reply?: { title: string }; list_reply?: { title: string } } };
type WaStatus = { id: string; status: string; errors?: { title?: string; message?: string }[] };

export async function POST(req: Request) {
  const raw = await req.text();
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (secret) {
    const got = req.headers.get("x-hub-signature-256") ?? "";
    const want = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
    if (got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) return new Response("Bad signature", { status: 401 });
  }
  let body: { entry?: { changes?: { value?: { statuses?: WaStatus[]; messages?: WaMessage[] } }[] }[] };
  try { body = JSON.parse(raw); } catch { return new Response("Bad JSON", { status: 400 }); }
  const db = adminDb();
  for (const change of body.entry?.flatMap((e) => e.changes ?? []) ?? []) {
    for (const s of change.value?.statuses ?? []) {
      if (!["sent", "delivered", "read", "failed"].includes(s.status)) continue;
      const [m] = await db.select({ id: messageLog.id, status: messageLog.status }).from(messageLog).where(eq(messageLog.providerId, s.id)).limit(1);
      if (!m) continue;
      // Webhooks arrive out of order: never downgrade read → delivered.
      if (s.status !== "failed" && (RANK[s.status] ?? 0) <= (RANK[m.status] ?? 0)) continue;
      await db.update(messageLog).set({
        status: s.status as "sent" | "delivered" | "read" | "failed",
        ...(s.status === "failed" ? { error: s.errors?.[0]?.message ?? s.errors?.[0]?.title ?? "WhatsApp delivery failed" } : {}),
      }).where(eq(messageLog.id, m.id));
    }
    for (const msg of change.value?.messages ?? []) {
      const text = msg.text?.body ?? msg.button?.text ?? msg.interactive?.button_reply?.title ?? msg.interactive?.list_reply?.title;
      if (!text) continue; // media etc. are ignored
      try {
        await handleInbound({ channel: "whatsapp", from: msg.from, text, provider: "whatsapp", providerId: msg.id });
      } catch (e) {
        console.error("WhatsApp inbound failed:", e); // still 200: Meta would retry the whole batch
      }
    }
  }
  return Response.json({ ok: true });
}
