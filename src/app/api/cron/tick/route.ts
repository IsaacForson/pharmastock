import { timingSafeEqual } from "node:crypto";
import { scheduleRecurring } from "@/lib/worker/daily";
import { runDueJobs } from "@/lib/worker/runner";

export const maxDuration = 60;

async function tick(req: Request) {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  if (!secret || got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) return new Response("Unauthorized", { status: 401 });
  await scheduleRecurring();
  const processed = await runDueJobs(50);
  return Response.json({ ok: true, processed });
}

export const GET = tick;
export const POST = tick;
