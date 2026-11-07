import { getBoss } from "./server/queue.js";
import { recoverInterruptedRuns, runProviderRun } from "./server/providers.js";

const recovered = await recoverInterruptedRuns();
if (recovered) console.warn(`Marked ${recovered} interrupted provider run(s) as unknown; no calls were retried.`);
const boss = await getBoss();
await boss.work<{ runId: string }>("generate-provider-run", { pollingIntervalSeconds: 2, localConcurrency: 2 }, async (jobs) => {
  await Promise.all(jobs.map((job) => runProviderRun(job.data.runId)));
});
console.log("Creative generation worker is running.");

const shutdown = async () => { await boss.stop({ graceful: true, timeout: 30_000 }); process.exit(0); };
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
