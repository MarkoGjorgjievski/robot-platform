import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, runs } from '@robot/db';
import { recordUsage, resetUsage, snapshotUsage } from '@robot/agent';
import { costSince, addRunCost } from './record-run-cost.js';

// The usage counter is process-wide; every case starts and ends it empty so
// no other test in this worker sees these tokens.
afterEach(() => resetUsage());

describe('costSince', () => {
  it('prices the tokens recorded since the snapshot, at the list rates', () => {
    resetUsage();
    const before = snapshotUsage();
    // claude-sonnet-5: $3 per million input tokens, $15 per million output tokens (usage.ts).
    recordUsage('claude-sonnet-5', { input_tokens: 1_000_000, output_tokens: 100_000 });
    expect(costSince(before)).toBeCloseTo(3 + 1.5, 6);
  });

  it('is zero when nothing was recorded', () => {
    resetUsage();
    expect(costSince(snapshotUsage())).toBe(0);
  });
});

describe('addRunCost', () => {
  it('adds to the run, twice, and ignores nothing-to-add', async () => {
    const [run] = await db.insert(runs).values({ status: 'planned', inputLabel: 'cost-test' }).returning({ id: runs.id });
    try {
      await addRunCost(db, run!.id, 0.0123);
      await addRunCost(db, run!.id, 0.0123);
      await addRunCost(db, run!.id, 0);
      await addRunCost(db, run!.id, Number.NaN);
      const row = await db.query.runs.findFirst({ where: eq(runs.id, run!.id), columns: { costUsd: true } });
      expect(Number(row!.costUsd)).toBeCloseTo(0.0246, 4);
    } finally {
      await db.delete(runs).where(eq(runs.id, run!.id));
    }
  });
});
