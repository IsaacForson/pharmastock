import { z } from "zod";
import { withTenant } from "@/db";
import { aiConfigured, ask, MAX_QUESTION, type AskEvent } from "@/lib/ai-ask";
import { branchScope } from "@/lib/analytics";
import { audit, getCtx, tx } from "@/lib/auth";
import { localDay } from "@/lib/format";
import { can } from "@/lib/permissions";
import { hasFeature } from "@/lib/plans";

export const maxDuration = 120;

const body = z.object({ question: z.string().trim().min(3).max(MAX_QUESTION), branch: z.string().max(40).optional() });

// shortcut: in-memory per-user limit per process; move to Postgres when running several instances.
const HOURLY = 30;
const hits = new Map<string, number[]>();
const limited = (userId: string) => {
  const now = Date.now(), recent = (hits.get(userId) ?? []).filter((t) => now - t < 3600_000);
  hits.set(userId, [...recent, now]);
  return recent.length >= HOURLY;
};

/** Streams NDJSON progress events ({type:"tool"|"answer"|"error"}) while the model (on Groq) answers using read-only tools. */
export async function POST(req: Request) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: "Please sign in again." }, { status: 401 });
  if (!can(ctx.user.role, "ai.ask") || !hasFeature(ctx.tenant, "ai")) return Response.json({ error: "Ask PharmaStock isn't available on your account." }, { status: 403 });
  if (!aiConfigured()) return Response.json({ error: "Ask PharmaStock isn't set up on this server yet." }, { status: 503 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Type a question of 3 to 500 characters." }, { status: 422 });
  if (limited(ctx.user.id)) return Response.json({ error: `You've asked ${HOURLY} questions this hour. Please try again a little later.` }, { status: 429 });
  const { question, branch } = parsed.data;
  const scope = branchScope({ role: ctx.user.role, consolidated: hasFeature(ctx.tenant, "consolidated"), branches: ctx.branches, current: ctx.branchId, wanted: branch ?? null, defaultAll: true });
  const s = {
    tenant: ctx.tenant, branches: ctx.branches.filter((b) => scope.ids.includes(b.id)), canSeeCost: can(ctx.user.role, "reports.margin"), today: localDay(ctx.tenant.timezone),
  };
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(c) {
      const send = (e: AskEvent) => c.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      let tools: string[] = [];
      let outcome = "answered";
      try {
        tools = await ask(question, s, (fn) => withTenant(ctx.tenant.id, fn), (e) => { if (e.type === "error") outcome = "error"; send(e); });
      } catch (e) {
        console.error("ask failed:", e);
        outcome = "failed";
        send({ type: "error", message: "Something went wrong reaching the assistant. Please try again." });
      }
      await tx(ctx, (t) => audit(t, ctx, "ask", "ai", null, { details: { question, branches: scope.all ? "all" : scope.ids, tools, outcome } })).catch((e) => console.error("ask audit failed:", e));
      c.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
