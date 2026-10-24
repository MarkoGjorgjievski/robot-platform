import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, runs } from '@robot/db';
import { addRunCost } from './record-run-cost.js';

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
