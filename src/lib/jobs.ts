import type { Tx } from "@/db";
import { jobs } from "@/db/schema";

/**
 * Job types processed by scripts/worker.mts (and /api/cron/tick). Payload shapes:
 *  message.send        { messageId, waTemplate?, waParams? }  deliver a queued message_log row
 *  webhook.deliver     { deliveryId }                         POST an outgoing webhook
 *  export.run          { exportJobId }                        build a full tenant export zip
 *  daily.tenant        {}                                     per-tenant nightly sweep: expiry/stock/recall/refill alerts
 *  owner.summary       { day }                                owner's end-of-day WhatsApp summary
 *  billing.sweep       {}                                     platform-wide: trial/subscription status
 *  fx.refresh          {}                                     platform-wide: daily exchange-rate refresh
 */
export type JobType = "message.send" | "webhook.deliver" | "export.run" | "daily.tenant" | "owner.summary" | "billing.sweep" | "fx.refresh";

export async function enqueue(t: Tx, tenantId: string | null, type: JobType, payload: Record<string, unknown> = {}, opts: { runAt?: Date; dedupeKey?: string } = {}) {
  await t.insert(jobs).values({ tenantId, type, payload, runAt: opts.runAt ?? new Date(), dedupeKey: opts.dedupeKey }).onConflictDoNothing();
}
