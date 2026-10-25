import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "@/db";
import { jobs, tenants } from "@/db/schema";
import { claimJobs, requeueStuck, runDueJobs } from "../runner";

let tenantId: string;
const past = new Date("2000-01-01T00:00:00Z"); // earliest in the table, so these are claimed first

beforeAll(async () => {
  const [t] = await adminDb().insert(tenants).values({ name: "Worker test", slug: `worker-test-${Date.now()}` }).returning();
  tenantId = t.id;
});
afterAll(async () => {
  await adminDb().delete(tenants).where(eq(tenants.id, tenantId)); // cascades to jobs
});

describe("job claiming", () => {
  it("concurrent claims get disjoint jobs (SKIP LOCKED)", async () => {
    const rows = await adminDb().insert(jobs).values(Array.from({ length: 6 }, () => ({ tenantId, type: "test.noop", runAt: past }))).returning();
    const [a, b] = await Promise.all([claimJobs(3), claimJobs(3)]);
    const mine = new Set(rows.map((r) => r.id));
    const ids = [...a, ...b].map((j) => j.id).filter((id) => mine.has(id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(6);
    const after = await adminDb().select().from(jobs).where(inArray(jobs.id, [...mine]));
    expect(after.every((j) => j.status === "running" && j.attempts === 1 && j.lockedAt)).toBe(true);
    await adminDb().delete(jobs).where(inArray(jobs.id, [...mine]));
  });

  it("re-queues jobs stuck in running", async () => {
    const [j] = await adminDb().insert(jobs).values({ tenantId, type: "test.noop", status: "running", attempts: 1, lockedAt: new Date(Date.now() - 20 * 60_000), runAt: past }).returning();
    await requeueStuck();
    const [after] = await adminDb().select().from(jobs).where(eq(jobs.id, j.id));
    expect(after.status).toBe("pending");
    await adminDb().delete(jobs).where(eq(jobs.id, j.id));
  });

  it("marks done, retries with backoff, and fails after 5 attempts", async () => {
    const rows = await adminDb().insert(jobs).values([
      { tenantId, type: "test.ok", runAt: past },
      { tenantId, type: "test.fail", runAt: past },
      { tenantId, type: "test.fail", runAt: past, attempts: 4 },
    ]).returning();
    const n = await runDueJobs(3, { "test.ok": async () => {}, "test.fail": async () => { throw new Error("boom"); } });
    expect(n).toBe(3);
    const byId = new Map((await adminDb().select().from(jobs).where(inArray(jobs.id, rows.map((r) => r.id)))).map((j) => [j.id, j]));
    expect(byId.get(rows[0].id)!.status).toBe("done");
    const retry = byId.get(rows[1].id)!;
    expect(retry.status).toBe("pending");
    expect(retry.lastError).toBe("boom");
    expect(retry.runAt.getTime()).toBeGreaterThan(Date.now() + 30_000);
    const dead = byId.get(rows[2].id)!;
    expect(dead.status).toBe("failed");
    expect(dead.attempts).toBe(5);
  });
});
