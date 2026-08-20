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
    expect(rollUpStatus({ pending: 0, done: 12, failed: 0 })).toBe('completed');
  });

  it('is partial when some failed — the normal outcome at scale', () => {
    // Spec §1.2: "480 of 500 succeeded" is what a real run looks like, and the
    // old binary completed/failed could not say it.
    expect(rollUpStatus({ pending: 0, done: 480, failed: 20 })).toBe('partial');
  });

  it('is failed only when nothing succeeded at all', () => {
    expect(rollUpStatus({ pending: 0, done: 0, failed: 8 })).toBe('failed');
  });

  it('stays extracting while work remains', () => {
    expect(rollUpStatus({ pending: 3, done: 5, failed: 1 })).toBe('extracting');
  });

  it('treats a run with no items at all as completed rather than failed', () => {
    // A detail-mode source whose InputSet was empty planned nothing. That is an
    // empty result, not an error.
    expect(rollUpStatus({ pending: 0, done: 0, failed: 0 })).toBe('completed');
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
});
