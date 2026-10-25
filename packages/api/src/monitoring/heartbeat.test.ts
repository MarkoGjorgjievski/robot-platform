// Spec 2026-10-25 monitoring §2.1, §3.2, §4 "Worker": the heartbeat upserts, refreshes, deletes on stop, purges, and
// never throws.
import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db, workers } from '@robot/db';
import { jobQueueName } from '../jobs/queue.js';
import { startHeartbeat, type WorkerState } from './heartbeat.js';
import { createLog, type LogLevel } from './log.js';

const q = () => jobQueueName();
const row = async (id: string) => db.query.workers.findFirst({ where: eq(workers.id, id) });
const until = async (pred: () => Promise<boolean>, ms = 10_000) => {
  const t = Date.now() + ms;
  while (!(await pred())) { if (Date.now() > t) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 25)); }
};
const state = (): WorkerState => ({ browsers: { inUse: 1, max: 3 }, lanes: { interactive: 1, background: 0, runs: 0 }, websiteChecks: false, recurringRuns: true });
const capture = () => {
  const lines: Array<{ line: string; level: LogLevel }> = [];
  return { lines, log: createLog('heartbeat', { env: { LOG_FORMAT: 'json', LOG_LEVEL: 'debug' }, sink: (line, level) => lines.push({ line, level }) }) };
};
const id = () => `hb-test:${process.pid}:${randomUUID().slice(0, 8)}`;
afterEach(async () => { await db.delete(workers).where(eq(workers.queue, q())); });

describe('the heartbeat (spec 2026-10-25 monitoring §2.1)', () => {
  it('upserts its row at once and on every beat, keeps started_at, and deletes the row on stop', async () => {
    const me = id();
    const hb = startHeartbeat({ workerId: me, queue: q(), version: 'v-test', state, everyMs: 100, log: capture().log });
    await until(async () => !!(await row(me)));
    const first = (await row(me))!;
    expect(first).toMatchObject({ queue: q(), version: 'v-test', browsers: { inUse: 1, max: 3 }, lanes: { interactive: 1, background: 0, runs: 0 }, websiteChecks: false, recurringRuns: true });
    await until(async () => (await row(me))!.beatAt.getTime() > first.beatAt.getTime());
    expect((await row(me))!.startedAt.getTime()).toBe(first.startedAt.getTime());
    expect(hb.lastBeatAt()).not.toBeNull();
    await hb.stop();
    expect(await row(me)).toBeUndefined();
  });

  it('a stop removes only its own row, and rows older than a day are purged', async () => {
    const other = id();
    await db.insert(workers).values({ id: other, queue: q(), startedAt: new Date() });
    const stale = id();
    await db.insert(workers).values({ id: stale, queue: q(), startedAt: new Date(), beatAt: sql`now() - interval '25 hours'` });
    const me = id();
    const hb = startHeartbeat({ workerId: me, queue: q(), version: 'v', state, everyMs: 60_000, log: capture().log });
    await until(async () => !!(await row(me)));
    expect(await row(stale)).toBeUndefined();
    await hb.stop();
    expect(await row(me)).toBeUndefined();
    expect(await row(other)).toBeDefined();
  });

  it('RF4: a database that fails for a while — no throw, one warn line, then beating again', async () => {
    let failures = 3;
    const { lines, log } = capture();
    const hb = startHeartbeat({
      workerId: 'rf4', queue: 'rf4', version: 'v', state, everyMs: 30, log, remove: async () => {},
      write: async () => { if (failures-- > 0) throw new Error('connect ECONNREFUSED postgresql://robot:rf4-pass@db.test:5432'); },
    });
    await until(async () => hb.lastBeatAt() !== null);
    await hb.stop();
    expect(lines.filter((l) => l.level === 'warn')).toHaveLength(1);
    expect(lines.some((l) => l.level === 'info' && l.line.includes('beating again'))).toBe(true);
    expect(lines.map((l) => l.line).join('\n')).not.toContain('rf4-pass');
  });

  it('a state that throws is a failed beat, not a crash', async () => {
    const { lines, log } = capture();
    const hb = startHeartbeat({ workerId: 'bad-state', queue: 'x', version: 'v', state: () => { throw new Error('gate gone'); }, everyMs: 30, log, write: async () => {}, remove: async () => {} });
    await new Promise((r) => setTimeout(r, 120));
    await hb.stop();
    expect(hb.lastBeatAt()).toBeNull();
    expect(lines.filter((l) => l.level === 'warn')).toHaveLength(1);
  });
});
