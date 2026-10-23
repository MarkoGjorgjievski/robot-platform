import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, sourceVerifications, driftChecks, coverageChecks, captures, runs } from '@robot/db';
import { createTestSource, deleteTestSource } from '../test-helpers/source.js';
import { closeJobRows } from './rows.js';
import { RUN_STOPPED } from './types.js';

const proofPage = (status: string) => ({ kind: 'proof-page', status, url: 'https://shop.example/p/1', startedAt: '2026-10-23T10:00:00.000Z' });

describe('closeJobRows', () => {
  it('closes every unfinished row the job owns, each the way the app words it; finished rows and other jobs\' rows stay', async () => {
    const sourceId = await createTestSource({ schema: [] });
    const job = randomUUID(); const other = randomUUID();
    try {
      const [drift] = await db.insert(driftChecks).values({ sourceId, jobId: job }).returning();
      const [driftDone] = await db.insert(driftChecks).values({ sourceId, jobId: job, status: 'done' }).returning();
      const [cover] = await db.insert(coverageChecks).values({ sourceId, jobId: job }).returning();
      const [shot] = await db.insert(captures).values({ sourceId, url: 'https://shop.example/p/1', jobId: job, metadata: proofPage('capturing') }).returning();
      const [shotDone] = await db.insert(captures).values({ sourceId, url: 'https://shop.example/p/1', jobId: job, metadata: proofPage('done') }).returning();
      const [extracting] = await db.insert(runs).values({ sourceId, status: 'extracting', jobId: job }).returning();
      const [cancelling] = await db.insert(runs).values({ sourceId, status: 'cancelling', jobId: job, errorMessage: null }).returning();
      const [theirs] = await db.insert(driftChecks).values({ sourceId, jobId: other }).returning();

      await closeJobRows(db, job, { runSentence: RUN_STOPPED });

      expect(await db.query.driftChecks.findFirst({ where: eq(driftChecks.id, drift!.id) })).toMatchObject({ status: 'failed', error: 'stalled' });
      expect((await db.query.driftChecks.findFirst({ where: eq(driftChecks.id, drift!.id) }))!.completedAt).not.toBeNull();
      expect(await db.query.driftChecks.findFirst({ where: eq(driftChecks.id, driftDone!.id) })).toMatchObject({ status: 'done', error: null });
      expect(await db.query.coverageChecks.findFirst({ where: eq(coverageChecks.id, cover!.id) })).toMatchObject({ status: 'failed', error: 'stalled' });
      expect((await db.query.captures.findFirst({ where: eq(captures.id, shot!.id) }))!.metadata).toEqual({ ...proofPage('failed'), error: 'stalled' });
      expect((await db.query.captures.findFirst({ where: eq(captures.id, shotDone!.id) }))!.metadata).toEqual(proofPage('done'));
      expect(await db.query.runs.findFirst({ where: eq(runs.id, extracting!.id) })).toMatchObject({ status: 'failed', errorMessage: RUN_STOPPED });
      expect(await db.query.runs.findFirst({ where: eq(runs.id, cancelling!.id) })).toMatchObject({ status: 'cancelled', errorMessage: null });
      expect(await db.query.driftChecks.findFirst({ where: eq(driftChecks.id, theirs!.id) })).toMatchObject({ status: 'running' });
    } finally { await deleteTestSource(sourceId); }
  });

  it('leaves the row the payload names (`except`), in every table', async () => {
    const sourceId = await createTestSource({ schema: [] });
    const job = randomUUID();
    try {
      const [v] = await db.insert(sourceVerifications).values({ sourceId, definitionHash: 'h', jobId: job }).returning();
      const [d] = await db.insert(driftChecks).values({ sourceId, jobId: job }).returning();
      const [c] = await db.insert(coverageChecks).values({ sourceId, jobId: job }).returning();
      const [s] = await db.insert(captures).values({ sourceId, url: 'https://shop.example/p/1', jobId: job, metadata: proofPage('capturing') }).returning();
      const [r] = await db.insert(runs).values({ sourceId, status: 'extracting', jobId: job }).returning();
      const kept = async () => [
        (await db.query.sourceVerifications.findFirst({ where: eq(sourceVerifications.id, v!.id) }))!.completedAt === null,
        (await db.query.driftChecks.findFirst({ where: eq(driftChecks.id, d!.id) }))!.status === 'running',
        (await db.query.coverageChecks.findFirst({ where: eq(coverageChecks.id, c!.id) }))!.status === 'running',
        ((await db.query.captures.findFirst({ where: eq(captures.id, s!.id) }))!.metadata as { status: string }).status === 'capturing',
        (await db.query.runs.findFirst({ where: eq(runs.id, r!.id) }))!.status === 'extracting',
      ];
      await closeJobRows(db, job, { runSentence: RUN_STOPPED, except: { table: 'drift_checks', id: d!.id } });
      expect(await kept()).toEqual([false, true, false, false, false]);
      const [d2] = await db.insert(driftChecks).values({ sourceId, jobId: job }).returning();
      const [s2] = await db.insert(captures).values({ sourceId, url: 'https://shop.example/p/2', jobId: job, metadata: proofPage('capturing') }).returning();
      await closeJobRows(db, job, { runSentence: RUN_STOPPED, except: { table: 'captures', id: s2!.id } });
      expect((await db.query.driftChecks.findFirst({ where: eq(driftChecks.id, d2!.id) }))!.status).toBe('failed');
      expect(((await db.query.captures.findFirst({ where: eq(captures.id, s2!.id) }))!.metadata as { status: string }).status).toBe('capturing');
    } finally { await deleteTestSource(sourceId); }
  });
});
