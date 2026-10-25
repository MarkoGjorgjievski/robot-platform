// Spec 2026-10-25 monitoring §4 "Worker": the heartbeat row, WORKER_HEALTH_PORT (200, then 503 while stopping), and a
// terminal failure reported. Test jobs only: no browser, no page.
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, jobs, workers } from '@robot/db';
import { enqueueJob, jobQueueName } from '@robot/api/jobs';
import { startErrorReceiver } from '@robot/api/test-helpers/error-receiver';
import { readWorkerConfig } from './config.js';
import { startWorker } from './worker.js';
import { startHealthServer } from './health.js';

const config = (env: Record<string, string> = {}) => readWorkerConfig({
  JOB_QUEUE: jobQueueName(), WORKER_TEST_JOBS: '1', WORKER_HEALTH_PORT: '0', WORKER_MIN_FREE_MB: '0', WORKER_POLL_MS: '50',
  WORKER_SHUTDOWN_MS: '1500', WEBSITE_CHECKS: 'off', RECURRING_RUNS: 'off', ...env,
});
const until = async (pred: () => Promise<boolean>, ms = 30_000) => {
  const t = Date.now() + ms;
  while (!(await pred())) { if (Date.now() > t) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 50)); }
};
const rowOf = (id: string) => db.query.workers.findFirst({ where: eq(workers.id, id) });

describe('the worker’s monitoring (spec 2026-10-25 monitoring §2.1, §2.4)', () => {
  it('beats into its row, answers 200 on its health port, 503 while it stops, and removes its row', async () => {
    const w = await startWorker(config(), { heartbeatMs: 200 });
    try {
      const me = w.runner.workerId;
      await until(async () => !!(await rowOf(me)));
      expect(await rowOf(me)).toMatchObject({ queue: jobQueueName(), browsers: { inUse: 0, max: 3 }, websiteChecks: false, recurringRuns: false });
      const health = `http://127.0.0.1:${w.health!.port}/healthz`;
      expect((await fetch(health)).status).toBe(200);
      const { id } = await enqueueJob(db, { type: 'test-sleep', payload: { ms: 10_000 } });
      await until(async () => (await db.query.jobs.findFirst({ where: eq(jobs.id, id) }))?.status === 'running');
      await until(async () => ((await rowOf(me))?.lanes as { background?: number } | undefined)?.background === 1);
      const stopping = w.stop();
      expect((await fetch(health)).status).toBe(503);
      await stopping;
      expect(await rowOf(me)).toBeUndefined();
      await expect(fetch(health)).rejects.toThrow();
    } finally { await w.stop(); }
  });

  it('a health port already taken: the worker runs without it, and still beats', async () => {
    const taken = await startHealthServer({ port: 0, healthy: () => true });
    const w = await startWorker(config({ WORKER_HEALTH_PORT: String(taken.port) }), { heartbeatMs: 200 });
    try {
      expect(w.health).toBeNull();
      await until(async () => !!(await rowOf(w.runner.workerId)));
    } finally { await w.stop(); await taken.close(); }
  });

  it('a job that fails for good reaches ERROR_REPORT_URL once, as the worker, redacted', async () => {
    const receiver = await startErrorReceiver();
    const saved = process.env.ERROR_REPORT_URL;
    process.env.ERROR_REPORT_URL = receiver.url;
    const w = await startWorker(config(), { heartbeatMs: 200 });
    try {
      const { id } = await enqueueJob(db, { type: 'test-throw', payload: {} });
      await until(async () => receiver.reports.some((r) => r.body?.context?.jobId === id));
      await new Promise((r) => setTimeout(r, 500));
      const mine = receiver.reports.filter((r) => r.body?.context?.jobId === id);
      expect(mine).toHaveLength(1);
      expect(mine[0]!.body).toMatchObject({ service: 'worker', message: 'test-throw: could not reach http://***@proxy.test:7000', context: { jobId: id, type: 'test-throw', attempt: 1, queue: jobQueueName() } });
      expect(mine[0]!.raw).not.toContain('live-secret');
    } finally {
      await w.stop();
      if (saved === undefined) delete process.env.ERROR_REPORT_URL; else process.env.ERROR_REPORT_URL = saved;
      await receiver.close();
    }
  });
});
