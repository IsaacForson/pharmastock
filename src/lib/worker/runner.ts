import { eq, sql } from "drizzle-orm";
import { adminDb } from "@/db";
import { jobs } from "@/db/schema";

export type Job = typeof jobs.$inferSelect;
export type Handler = (job: Job) => Promise<void>;

export const MAX_ATTEMPTS = 5;
const STUCK_MINUTES = 10;

/** Delay before retry n (1-based): 1, 2, 4, 8 … minutes, capped at 1 hour. */
export const backoffMs = (attempts: number) => Math.min(60_000 * 2 ** Math.max(attempts - 1, 0), 3600_000);

/** Jobs whose worker died mid-run go back to pending (or fail once out of attempts). */
export async function requeueStuck() {
  await adminDb().update(jobs).set({
    status: sql`case when ${jobs.attempts} >= ${MAX_ATTEMPTS} then 'failed'::job_status else 'pending'::job_status end`,
    lockedAt: null,
    lastError: sql`coalesce(${jobs.lastError}, 'worker timed out')`,
  }).where(sql`${jobs.status} = 'running' and ${jobs.lockedAt} < now() - make_interval(mins => ${STUCK_MINUTES})`);
}

/** Atomically claims up to `limit` due jobs. SKIP LOCKED lets concurrent workers claim disjoint sets. */
export function claimJobs(limit: number): Promise<Job[]> {
  return adminDb().update(jobs)
    .set({ status: "running", lockedAt: sql`now()`, attempts: sql`${jobs.attempts} + 1` })
    .where(sql`${jobs.id} in (select id from jobs where status = 'pending' and run_at <= now() order by run_at for update skip locked limit ${limit})`)
    .returning();
}

async function finish(job: Job, err: unknown) {
  if (!err) {
    await adminDb().update(jobs).set({ status: "done", lockedAt: null, lastError: null }).where(eq(jobs.id, job.id));
    return;
  }
  const lastError = (err instanceof Error ? err.message : String(err)).slice(0, 2000);
  const failed = job.attempts >= MAX_ATTEMPTS;
  await adminDb().update(jobs).set({
    status: failed ? "failed" : "pending", lockedAt: null, lastError,
    runAt: failed ? job.runAt : new Date(Date.now() + backoffMs(job.attempts)),
  }).where(eq(jobs.id, job.id));
}

/** Claims and runs due jobs once. Returns how many were processed. */
export async function runDueJobs(limit = 20, handlers?: Record<string, Handler>): Promise<number> {
  const map: Record<string, Handler> = handlers ?? (await import("./handlers")).HANDLERS;
  await requeueStuck();
  const claimed = await claimJobs(limit);
  for (const job of claimed) {
    const h = map[job.type];
    try {
      if (!h) throw new Error(`Unknown job type ${job.type}`);
      await h(job);
      await finish(job, null);
    } catch (e) {
      console.error(`[job ${job.type} ${job.id}] attempt ${job.attempts}:`, (e as Error).message);
      await finish(job, e);
    }
  }
  return claimed.length;
}
