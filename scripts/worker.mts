// Long-running job worker: `pnpm worker`. Run as many copies as you like; jobs are claimed with SKIP LOCKED.
import "dotenv/config";
import { scheduleRecurring } from "../src/lib/worker/daily";
import { runDueJobs } from "../src/lib/worker/runner";

const POLL_MS = 5_000;
const SCHEDULE_MS = 60_000;
let stopping = false;
let wake: (() => void) | null = null;

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    console.log(`${sig}: finishing current batch…`);
    stopping = true;
    wake?.();
  });
}

let lastSchedule = 0;
console.log("PharmaStock worker started");
while (!stopping) {
  try {
    if (Date.now() - lastSchedule > SCHEDULE_MS) {
      await scheduleRecurring();
      lastSchedule = Date.now();
    }
    // Drain while there is work, then sleep.
    if ((await runDueJobs(20)) > 0) continue;
  } catch (e) {
    console.error("worker loop error:", e);
  }
  await new Promise<void>((r) => { wake = r; setTimeout(r, POLL_MS); });
}
console.log("worker stopped");
process.exit(0);
