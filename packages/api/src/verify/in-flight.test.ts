// A verification in flight (spec 2026-10-23 §4.5): a row whose job is still live is in flight however
// old; with no live job, the time rule closes it as before. A start enqueues its `verify` job in the
// transaction that inserts the row, under the website row lock.
import { describe, it, expect, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, sourceVerifications } from '@robot/db';
import { VERIFY_STALL_MS } from '@robot/scraper';
import { createTestSource, deleteTestSource } from '../test-helpers/source.js';
import { enqueueJob } from '../jobs/queue.js';
import { resolveInFlightVerification, startVerificationRow } from './in-flight.js';
import { jobsOf } from '../test-helpers/jobs.js';

const sources: string[] = [];
afterAll(async () => { for (const s of sources) await deleteTestSource(s); });
const source = async () => { const id = await createTestSource({ schema: [] }); sources.push(id); return id; };
const old = () => new Date(Date.now() - VERIFY_STALL_MS - 60_000);
const verifyJobsOf = async (sourceId: string) => (await jobsOf('verify')).filter((j) => (j.payload as { sourceId?: string }).sourceId === sourceId);

describe('a verification in flight (spec 2026-10-23 §4.5)', () => {
  it('a verification older than the stall window whose job is queued stays in flight', async () => {
    const s = await source();
    const { id: jobId } = await enqueueJob(db, { type: 'verify', payload: {} });
    const [v] = await db.insert(sourceVerifications).values({ sourceId: s, definitionHash: 'h', startedAt: old(), jobId }).returning();
    expect(await resolveInFlightVerification(db, s)).toEqual({ id: v!.id });
    expect((await db.query.sourceVerifications.findFirst({ where: eq(sourceVerifications.id, v!.id) }))!.completedAt).toBeNull();
  });

  it('one with no live job follows the time rule, as before', async () => {
    const s = await source();
    const [v] = await db.insert(sourceVerifications).values({ sourceId: s, definitionHash: 'h', startedAt: old() }).returning();
    expect(await resolveInFlightVerification(db, s)).toBeNull();
    expect((await db.query.sourceVerifications.findFirst({ where: eq(sourceVerifications.id, v!.id) }))!.errorMessage).toBe('stalled');
  });

  it('one whose job is past its start window is not live: the time rule closes it', async () => {
    const s = await source();
    const { id: jobId } = await enqueueJob(db, { type: 'verify', payload: {}, startWithinMs: -1000 });
    const [v] = await db.insert(sourceVerifications).values({ sourceId: s, definitionHash: 'h', startedAt: old(), jobId }).returning();
    expect(await resolveInFlightVerification(db, s)).toBeNull();
    expect((await db.query.sourceVerifications.findFirst({ where: eq(sourceVerifications.id, v!.id) }))!.errorMessage).toBe('stalled');
  });

  it('a start with job options inserts the row and its verify job in one transaction; a second start is in progress', async () => {
    const s = await source();
    const a = await startVerificationRow(db, s, 'h', undefined, { onlyKeys: ['price'], free: true });
    expect(a.status).toBe('started');
    const [job] = await verifyJobsOf(s);
    expect(job).toMatchObject({ status: 'queued', key: `verify:${a.verificationId}`, maxAttempts: 2, payload: { sourceId: s, verificationId: a.verificationId, onlyKeys: ['price'], free: true } });
    expect((await db.query.sourceVerifications.findFirst({ where: eq(sourceVerifications.id, a.verificationId) }))!.jobId).toBe(job!.id);
    expect(await startVerificationRow(db, s, 'h', undefined, {})).toEqual({ verificationId: a.verificationId, status: 'in-progress' });
    expect(await verifyJobsOf(s)).toHaveLength(1);
  });

  it('a start whose onStarted write throws leaves neither the row nor the job', async () => {
    const s = await source();
    await expect(startVerificationRow(db, s, 'h', async () => { throw new Error('boom'); }, {})).rejects.toThrow('boom');
    expect(await verifyJobsOf(s)).toEqual([]);
    expect(await db.query.sourceVerifications.findMany({ where: eq(sourceVerifications.sourceId, s) })).toEqual([]);
  });

  it('without job options, no job (scripts start their own run)', async () => {
    const s = await source();
    const a = await startVerificationRow(db, s, 'h');
    expect(a.status).toBe('started');
    expect(await verifyJobsOf(s)).toEqual([]);
    expect((await db.query.sourceVerifications.findFirst({ where: eq(sourceVerifications.id, a.verificationId) }))!.jobId).toBeNull();
  });
});
