// Spec 2026-10-25 monitoring §2.3, §4 "Unit": the watchdog's queries with seeded rows — backlog, silent, dead worker,
// dedupe. Every row is on this file's own JOB_QUEUE.
import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db, jobs, runs, workers } from '@robot/db';
import { jobQueueName } from '../jobs/queue.js';
import { createTestSource, deleteTestSource } from '../test-helpers/source.js';
import { findAttention, type AttentionItem } from './attention.js';
import { watchJobs } from './watchdog.js';
import { createLog, type LogLevel } from './log.js';

const q = () => jobQueueName();
const ago = (s: number) => sql`now() - make_interval(secs => ${s})`;
const ahead = (s: number) => sql`now() + make_interval(secs => ${s})`;
type Over = { [K in keyof typeof jobs.$inferInsert]?: (typeof jobs.$inferInsert)[K] | ReturnType<typeof sql> };
const running = (over: Over = {}) => ({
  queue: q(), type: 'reachability', status: 'running', attempts: 1, lockedBy: 'w:1:aaaa#t1', lockedUntil: ahead(30), startedAt: ago(60), progressAt: ago(5), ...over,
});
afterEach(async () => {
  await db.delete(jobs).where(eq(jobs.queue, q()));
  await db.delete(workers).where(eq(workers.queue, q()));
});

describe('what needs attention (spec 2026-10-25 monitoring §2.3)', () => {
  it('backlog: a queued job due more than 10 minutes ago whose lane nobody is working', async () => {
    const [old] = await db.insert(jobs).values({ queue: q(), type: 'reachability', runAfter: ago(11 * 60) }).returning();
    await db.insert(jobs).values({ queue: q(), type: 'reachability', runAfter: ago(9 * 60) });
    await db.insert(jobs).values({ queue: q(), type: 'reachability', runAfter: ahead(60) });
    const items = await findAttention(q());
    expect(items).toEqual([expect.objectContaining({ kind: 'backlog', jobId: old!.id, type: 'reachability', lane: 'interactive', workerId: null })]);
    expect(items[0]!.ageMs).toBeGreaterThan(10 * 60_000);
  });

  it('RF1: a queued job behind a busy lane is not a backlog; the same job with its lane idle is', async () => {
    // website-check: background, at most one at a time — the rest wait their turn while it works.
    await db.insert(jobs).values(running({ type: 'website-check', lockedBy: 'w:1:aaaa#t1' }));
    const [waiting] = await db.insert(jobs).values({ queue: q(), type: 'website-check', runAfter: ago(40 * 60) }).returning();
    // A second run behind WORKER_RUNS=1.
    await db.insert(jobs).values(running({ type: 'run', lockedBy: 'w:1:aaaa#t2' }));
    await db.insert(jobs).values({ queue: q(), type: 'run', runAfter: ago(3 * 3600) });
    // Another lane's work does not make interactive work busy.
    const [interactive] = await db.insert(jobs).values({ queue: q(), type: 'reachability', runAfter: ago(11 * 60) }).returning();
    expect((await findAttention(q())).map((i) => [i.kind, i.jobId])).toEqual([['backlog', interactive!.id]]);
    // The background lane goes idle: nothing running there, its last claim 11 minutes ago.
    await db.update(jobs).set({ status: 'done', lockedBy: null, lockedUntil: null, startedAt: ago(11 * 60), finishedAt: ago(10 * 60) })
      .where(sql`${jobs.queue} = ${q()} AND ${jobs.type} = 'website-check' AND ${jobs.status} = 'running'`);
    expect((await findAttention(q())).filter((i) => i.kind === 'backlog').map((i) => i.jobId).sort()).toEqual([interactive!.id, waiting!.id].sort());
  });

  it('silent: running with a live lease and no progress for over half its stuckMs; recent progress or a lapsed lease is not', async () => {
    // reachability's stuckMs is 60 s: silent past 30 s.
    const [quiet] = await db.insert(jobs).values(running({ progressAt: ago(40) })).returning();
    await db.insert(jobs).values(running({ lockedBy: 'w:1:aaaa#t2', progressAt: ago(10) }));
    await db.insert(jobs).values(running({ lockedBy: 'w:1:aaaa#t3', progressAt: ago(40), lockedUntil: ago(5) }));
    const items = await findAttention(q());
    expect(items).toEqual([expect.objectContaining({ kind: 'silent', jobId: quiet!.id, workerId: 'w:1:aaaa', lane: 'interactive' })]);
    expect(items[0]!.ageMs).toBeGreaterThanOrEqual(39_000);
  });

  it('dead worker: a running job under a worker row whose beat is more than 2 minutes old', async () => {
    await db.insert(workers).values({ id: 'dead:1:aaaa', queue: q(), startedAt: new Date(), beatAt: ago(180) });
    await db.insert(workers).values({ id: 'live:1:bbbb', queue: q(), startedAt: new Date() });
    const [orphan] = await db.insert(jobs).values(running({ lockedBy: 'dead:1:aaaa#t1', lockedUntil: ago(60), progressAt: ago(170) })).returning();
    await db.insert(jobs).values(running({ lockedBy: 'live:1:bbbb#t1' }));
    const items = await findAttention(q());
    expect(items).toEqual([expect.objectContaining({ kind: 'dead-worker', jobId: orphan!.id, workerId: 'dead:1:aaaa' })]);
    expect(items[0]!.ageMs).toBeGreaterThanOrEqual(179_000);
  });

  it('RF5: worker ids with LIKE wildcards are matched exactly', async () => {
    await db.insert(workers).values({ id: 'w_1%:9:aaaa', queue: q(), startedAt: new Date(), beatAt: ago(300) });
    await db.insert(workers).values({ id: 'wX1Z:9:aaaa', queue: q(), startedAt: new Date() });
    const [mine] = await db.insert(jobs).values(running({ lockedBy: 'w_1%:9:aaaa#t1', lockedUntil: ago(10) })).returning();
    await db.insert(jobs).values(running({ lockedBy: 'wX1Z:9:aaaa#t2' }));
    expect((await findAttention(q())).map((i) => [i.kind, i.jobId, i.workerId])).toEqual([['dead-worker', mine!.id, 'w_1%:9:aaaa']]);
  });

  it('names the website and the run a job belongs to, and redacts its last error', async () => {
    const sourceId = await createTestSource({ schema: [] });
    try {
      const [run] = await db.insert(runs).values({ sourceId, status: 'pending' }).returning();
      const [j] = await db.insert(jobs).values({ queue: q(), type: 'run', payload: { runId: run!.id }, runAfter: ago(11 * 60), error: 'lost http://u:last-pass@h.test:1' }).returning();
      const [byRow] = await db.insert(jobs).values({ queue: q(), type: 'plan', payload: { sourceId: 'not-a-uuid', runId: 'nope' }, runAfter: ago(12 * 60) }).returning();
      await db.update(runs).set({ jobId: byRow!.id }).where(eq(runs.id, run!.id));
      const items = await findAttention(q());
      expect(items.find((i) => i.jobId === j!.id)).toMatchObject({ sourceId, runId: run!.id, websiteName: expect.any(String), lastError: 'lost http://***@h.test:1' });
      expect(items.find((i) => i.jobId === byRow!.id)).toMatchObject({ sourceId, runId: run!.id });
    } finally { await deleteTestSource(sourceId); }
  });
});

describe('watchJobs (spec 2026-10-25 monitoring §2.3)', () => {
  const capture = () => {
    const lines: Array<{ line: string; level: LogLevel }> = [];
    return { lines, log: createLog('watchdog', { env: { LOG_FORMAT: 'json' }, sink: (line, level) => lines.push({ line, level }) }) };
  };
  const item = (over: Partial<AttentionItem> = {}): AttentionItem => ({
    kind: 'silent', jobId: 'j1', type: 'verify', lane: 'background', ageMs: 500_000, workerId: 'w:1:a', sourceId: null, websiteName: null, runId: null,
    lastError: 'retry after http://u:wd-pass@h.test:1', ...over,
  });

  it('warns once per job and kind per hour, at warn, with its fields, redacted', async () => {
    const { lines, log } = capture();
    const seen = new Map<string, number>();
    let now = 1_000_000;
    const find = async () => [item(), item({ kind: 'dead-worker' })];
    expect(await watchJobs('q', { log, seen, now: () => now, find })).toHaveLength(2);
    now += 30 * 60_000;
    expect(await watchJobs('q', { log, seen, now: () => now, find })).toHaveLength(0);
    now += 31 * 60_000;
    expect(await watchJobs('q', { log, seen, now: () => now, find })).toHaveLength(2);
    expect(lines).toHaveLength(4);
    expect(lines.every((l) => l.level === 'warn')).toBe(true);
    expect(JSON.parse(lines[0]!.line)).toMatchObject({ scope: 'watchdog', kind: 'silent', jobId: 'j1', type: 'verify', lane: 'background', ageMs: 500_000 });
    expect(JSON.parse(lines[0]!.line).msg).toBe('silent: verify j1 running with no progress for 500 s');
    expect(lines.map((l) => l.line).join('\n')).not.toContain('wd-pass');
  });

  it('against seeded rows: a backlog job is warned once across two sweeps', async () => {
    await db.insert(jobs).values({ queue: q(), type: 'reachability', runAfter: ago(11 * 60) });
    const { lines, log } = capture();
    const seen = new Map<string, number>();
    await watchJobs(q(), { log, seen });
    await watchJobs(q(), { log, seen });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!.line).msg).toMatch(/^backlog: reachability [0-9a-f-]{36} due 11 min ago and nobody is taking it$/);
  });
});
