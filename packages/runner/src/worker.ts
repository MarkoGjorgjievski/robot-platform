import { db } from '@robot/db';
import { runs } from '@robot/db/schema';
import { eq, asc } from 'drizzle-orm';
import { executeRun } from './executor';

const POLL_INTERVAL = 5000;

async function pollForRun(): Promise<string | null> {
  const [run] = await db
    .select({ id: runs.id })
    .from(runs)
    .where(eq(runs.status, 'queued'))
    .orderBy(asc(runs.createdAt))
    .limit(1);

  return run?.id ?? null;
}

async function main() {
  console.log('Runner worker started. Polling for queued runs...');

  // Reset any stale "running" runs from previous crashes
  const stale = await db.update(runs)
    .set({ status: 'failed', errorMessage: 'Worker restarted — run was interrupted', completedAt: new Date() })
    .where(eq(runs.status, 'running'))
    .returning({ id: runs.id });

  if (stale.length > 0) {
    console.log(`Reset ${stale.length} stale running runs to failed`);
  }

  while (true) {
    try {
      const runId = await pollForRun();

      if (runId) {
        console.log(`\nPicked up run: ${runId}`);
        await executeRun(runId);
        console.log(`Run ${runId} finished\n`);
      } else {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
      }
    } catch (error) {
      console.error('Worker error:', error);
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
    }
  }
}

main().catch((err) => {
  console.error('Worker fatal error:', err);
  process.exit(1);
});
