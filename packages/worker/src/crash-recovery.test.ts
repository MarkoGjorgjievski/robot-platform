// Spec 2026-10-23 §10: a real worker process is killed mid-job; a second one finishes it (attempt 2), or —
// with one attempt allowed — fails it 'stalled'. The test jobs sleep; no browser, no page.
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { db, jobs } from '@robot/db';
import { enqueueJob, jobQueueName } from '@robot/api/jobs';

const pkg = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'worker-crash-'));
const children: ChildProcess[] = [];
const get = async (id: string) => (await db.query.jobs.findFirst({ where: eq(jobs.id, id) }))!;
const until = async (pred: () => Promise<boolean>, ms = 60_000) => {
  const t = Date.now() + ms;
  while (!(await pred())) { if (Date.now() > t) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 100)); }
};

function worker(stopFile: string): ChildProcess {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: pkg, stdio: 'ignore',
    env: { ...process.env, JOB_QUEUE: jobQueueName(), WORKER_TEST_JOBS: '1', WEBSITE_CHECKS: 'off', WORKER_LEASE_MS: '2000',
      WORKER_POLL_MS: '100', WORKER_RETRY_MS: '100', WORKER_MIN_FREE_MB: '0', WORKER_SHUTDOWN_MS: '500', WORKER_STOP_FILE: stopFile,
      ANTHROPIC_API_KEY: '', JEV_SHADOW: '', TYPESAFE_API_KEY: '' },
  });
  children.push(child);
  return child;
}
const exited = (c: ChildProcess) => new Promise<void>((r) => (c.exitCode !== null || c.signalCode !== null ? r() : c.once('exit', () => r())));
const stop = async (c: ChildProcess, stopFile: string) => { writeFileSync(stopFile, ''); await exited(c); };

afterEach(async () => {
  for (const c of children) if (c.exitCode === null && c.signalCode === null) { c.kill('SIGKILL'); await exited(c); }
  children.length = 0;
});
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

describe('crash recovery across processes', () => {
  it('a job whose worker was killed is finished by the next worker, on attempt 2', async () => {
    const { id } = await enqueueJob(db, { type: 'test-sleep', payload: { ms: 600_000, finishOnAttempt: 2 }, maxAttempts: 2 });
    const a = worker(join(dir, 'a.stop'));
    await until(async () => (await get(id)).status === 'running');
    a.kill('SIGKILL');
    await exited(a);
    expect(await get(id)).toMatchObject({ status: 'running', attempts: 1 });
    const b = worker(join(dir, 'b.stop'));
    await until(async () => (await get(id)).status === 'done');
    expect(await get(id)).toMatchObject({ attempts: 2, result: { value: { attempt: 2 } } });
    await stop(b, join(dir, 'b.stop'));
    expect(b.exitCode).toBe(0);
  });

  it('with one attempt allowed, the job is failed stalled', async () => {
    const { id } = await enqueueJob(db, { type: 'test-sleep-once', payload: { ms: 600_000 }, maxAttempts: 1 });
    const a = worker(join(dir, 'c.stop'));
    await until(async () => (await get(id)).status === 'running');
    a.kill('SIGKILL');
    await exited(a);
    const b = worker(join(dir, 'd.stop'));
    await until(async () => (await get(id)).status === 'failed');
    expect(await get(id)).toMatchObject({ error: 'stalled', attempts: 1 });
    await stop(b, join(dir, 'd.stop'));
    expect(b.exitCode).toBe(0);
  });

  it('a graceful stop gives a running job back', async () => {
    const { id } = await enqueueJob(db, { type: 'test-sleep', payload: { ms: 600_000 }, maxAttempts: 2 });
    const a = worker(join(dir, 'e.stop'));
    await until(async () => (await get(id)).status === 'running');
    await stop(a, join(dir, 'e.stop'));
    expect(a.exitCode).toBe(0);
    expect(await get(id)).toMatchObject({ status: 'queued', attempts: 0 });
  });
});
