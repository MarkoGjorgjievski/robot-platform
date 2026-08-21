// packages/api/src/crawl/roll-up-run.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, runs, runItems, sources, orgs, projects, datasets } from '@robot/db';
import { rollUpStatus, finaliseRun } from './roll-up-run.js';

const SLUG = 'test-roll-up-run';
let orgId: string | null = null;

afterEach(async () => {
  if (orgId) await db.delete(orgs).where(eq(orgs.id, orgId));
  orgId = null;
});

describe('rollUpStatus', () => {
  it('is completed when every item succeeded', () => {
    expect(rollUpStatus({ pending: 0, running: 0, done: 12, failed: 0 })).toBe('completed');
  });

  it('is partial when some failed — the normal outcome at scale', () => {
    // Spec §1.2: "480 of 500 succeeded" is what a real run looks like, and the
    // old binary completed/failed could not say it.
    expect(rollUpStatus({ pending: 0, running: 0, done: 480, failed: 20 })).toBe('partial');
  });

  it('is failed only when nothing succeeded at all', () => {
    expect(rollUpStatus({ pending: 0, running: 0, done: 0, failed: 8 })).toBe('failed');
  });

  it('stays extracting while work remains', () => {
    expect(rollUpStatus({ pending: 3, running: 0, done: 5, failed: 1 })).toBe('extracting');
  });

  it('treats a run with no items at all as completed rather than failed', () => {
    // A detail-mode source whose InputSet was empty planned nothing. That is an
    // empty result, not an error.
    expect(rollUpStatus({ pending: 0, running: 0, done: 0, failed: 0 })).toBe('completed');
  });

  // Finding 1: a cancel with pending work left must settle to 'cancelled', not
  // silently revert to 'extracting' (which the dashboard treats as still active
  // and polls forever).
  it('settles to cancelled when told to stop and work is still pending', () => {
    expect(rollUpStatus({ pending: 3, running: 0, done: 5, failed: 1 }, true)).toBe('cancelled');
  });

  it('rolls up normally when cancelled but nothing is pending — the work genuinely finished, saying "cancelled" would be a lie', () => {
    expect(rollUpStatus({ pending: 0, running: 0, done: 12, failed: 0 }, true)).toBe('completed');
    expect(rollUpStatus({ pending: 0, running: 0, done: 480, failed: 20 }, true)).toBe('partial');
    expect(rollUpStatus({ pending: 0, running: 0, done: 0, failed: 8 }, true)).toBe('failed');
  });

  it('cancelled: false (or omitted) leaves today\'s behaviour unchanged', () => {
    expect(rollUpStatus({ pending: 3, running: 0, done: 5, failed: 1 }, false)).toBe('extracting');
    expect(rollUpStatus({ pending: 3, running: 0, done: 5, failed: 1 })).toBe('extracting');
  });

  // --- `running` is a status too. Nothing counted it, so an item left
  // `running` by an api-server restart (claimNextItem set it; nothing moves it
  // back) was invisible here: pending=0, done=7, failed=0 rolled a run of 8 up
  // to `completed` with the eighth row silently missing from the customer's CSV.
  it('is not terminal while an item is still running — a claimed item is unfinished work', () => {
    expect(rollUpStatus({ pending: 0, running: 1, done: 7, failed: 0 })).toBe('extracting');
  });

  it('never reports completed while an item is running, even with nothing pending', () => {
    // The exact restart shape: item 5 stuck `running`, the rest done. Saying
    // `completed` here is the lie — resultCount would be a row short and
    // nothing anywhere would say so.
    expect(rollUpStatus({ pending: 0, running: 1, done: 7, failed: 0 })).not.toBe('completed');
    expect(rollUpStatus({ pending: 0, running: 1, done: 5, failed: 2 })).not.toBe('partial');
  });

  it('settles a running item to cancelled when a stop was requested, exactly as pending does', () => {
    expect(rollUpStatus({ pending: 0, running: 1, done: 7, failed: 0 }, true)).toBe('cancelled');
  });
});

describe('finaliseRun', () => {
  it('derives resultCount from the DB — a caller cannot corrupt it with a stale local counter', async () => {
    const [org] = await db.insert(orgs).values({ name: SLUG, slug: SLUG }).returning();
    orgId = org!.id;
    const [project] = await db.insert(projects).values({ orgId: org!.id, name: SLUG, slug: SLUG }).returning();
    const [dataset] = await db.insert(datasets).values({ projectId: project!.id, name: SLUG, slug: SLUG, schema: [] }).returning();
    const [source] = await db.insert(sources).values({ datasetId: dataset!.id, name: SLUG, slug: SLUG, country: 'US' }).returning();
    const [run] = await db.insert(runs).values({ sourceId: source!.id, status: 'extracting' }).returning();
    await db.insert(runItems).values([
      { runId: run!.id, kind: 'detail', url: 'https://example.com/p/1', inputIndex: 0, status: 'done' },
      { runId: run!.id, kind: 'detail', url: 'https://example.com/p/2', inputIndex: 0, status: 'done' },
      { runId: run!.id, kind: 'detail', url: 'https://example.com/p/3', inputIndex: 0, status: 'done' },
      { runId: run!.id, kind: 'detail', url: 'https://example.com/p/4', inputIndex: 0, status: 'failed', error: 'blocked' },
    ]);

    // No rowCount argument any more — the old signature let a caller (e.g. one
    // of two concurrent loops) hand in its own partial, in-memory count and
    // overwrite the true total. finaliseRun must compute it itself.
    const status = await finaliseRun(db, run!.id);
    expect(status).toBe('partial');

    const [row] = await db.select().from(runs).where(eq(runs.id, run!.id));
    expect(row!.resultCount).toBe(3);
  });

  // The api-server-restart shape, end to end through the aggregate: one item
  // left `running` because the process died mid-item. Before this fix the
  // aggregate counted only pending/done/failed, so it saw pending=0, done=3,
  // failed=0 and wrote `completed` with resultCount=3 for a 4-item work list.
  it('does not report a run completed while one of its items is still running', async () => {
    const [org] = await db.insert(orgs).values({ name: SLUG, slug: SLUG }).returning();
    orgId = org!.id;
    const [project] = await db.insert(projects).values({ orgId: org!.id, name: SLUG, slug: SLUG }).returning();
    const [dataset] = await db.insert(datasets).values({ projectId: project!.id, name: SLUG, slug: SLUG, schema: [] }).returning();
    const [source] = await db.insert(sources).values({ datasetId: dataset!.id, name: SLUG, slug: SLUG, country: 'US' }).returning();
    const [run] = await db.insert(runs).values({ sourceId: source!.id, status: 'extracting' }).returning();
    await db.insert(runItems).values([
      { runId: run!.id, kind: 'listing', url: 'https://example.com/c/1', inputIndex: 0, status: 'done' },
      { runId: run!.id, kind: 'detail', url: 'https://example.com/p/1', inputIndex: 0, status: 'done' },
      { runId: run!.id, kind: 'detail', url: 'https://example.com/p/2', inputIndex: 0, status: 'done' },
      { runId: run!.id, kind: 'detail', url: 'https://example.com/p/3', inputIndex: 0, status: 'done' },
      { runId: run!.id, kind: 'detail', url: 'https://example.com/p/4', inputIndex: 0, status: 'running', startedAt: new Date() },
    ]);

    const status = await finaliseRun(db, run!.id);
    expect(status).toBe('extracting');

    const [row] = await db.select().from(runs).where(eq(runs.id, run!.id));
    expect(row!.status).toBe('extracting');
    // Non-terminal, so no completion timestamp is invented for a run that is
    // not actually done.
    expect(row!.completedAt).toBeNull();
  });
});
