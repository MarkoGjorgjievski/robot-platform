// The cache writers used to read the row, mutate the jsonb in JS, and write the
// whole blob back with no transaction — so a dashboard pin landing mid-save was
// silently overwritten by the save's stale snapshot (cache-reputation fixes W4,
// 2026-09-02). Every read-modify-write now runs inside a transaction whose read
// takes the row lock. This proves the lock is really taken: while another
// transaction holds the row FOR UPDATE, the writers block instead of reading a
// snapshot they would later clobber.

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, domainIntelligence } from '@robot/db';
import { eq, and } from 'drizzle-orm';
import { saveDomainCache, pinFieldPath, lookupDomainCache } from './domain-cache.js';

const DOMAIN = 'tx-guard.example';
const PAGE_TYPE = 'detail';

async function cleanup() {
  await db.delete(domainIntelligence).where(
    and(eq(domainIntelligence.domain, DOMAIN), eq(domainIntelligence.pageType, PAGE_TYPE)),
  );
}

async function seedRow() {
  await saveDomainCache({
    domain: DOMAIN,
    pageType: PAGE_TYPE,
    url: `https://${DOMAIN}/p/1`,
    interceptedRequests: [],
    fieldResults: {
      title: { value: 'Kallax', source: 'json-ld', path: '$.name', confidence: 0.95 },
    },
    discoveredFieldNames: ['title'],
    overallConfidence: 1,
    hasJsonLd: true,
    hasNextData: false,
  });
}

/** Resolves 'blocked' if the promise is still pending after `ms`. */
function raceAgainstTimer<T>(promise: Promise<T>, ms: number): Promise<T | 'blocked'> {
  return Promise.race([
    promise,
    new Promise<'blocked'>((resolve) => setTimeout(() => resolve('blocked'), ms)),
  ]);
}

describe('cache writers take the row lock', () => {
  beforeEach(async () => {
    await cleanup();
    await seedRow();
  });
  afterAll(cleanup);

  it('pinFieldPath cannot clobber a write that lands while it runs', async () => {
    // The lost-update scenario: a concurrent writer holds the row and changes
    // fieldPaths while a pin is in flight. Before the fix the pin's read ran
    // unlocked and immediately — its whole-blob write then overwrote the
    // concurrent change with the pre-change snapshot. With the read inside
    // the transaction taking the row lock, the pin blocks until the writer
    // commits and merges onto what the writer wrote.
    let pinPromise: Promise<boolean>;
    await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(domainIntelligence)
        .where(and(eq(domainIntelligence.domain, DOMAIN), eq(domainIntelligence.pageType, PAGE_TYPE)))
        .limit(1)
        .for('update');

      pinPromise = pinFieldPath({ domain: DOMAIN, pageType: PAGE_TYPE, field: 'title', path: '$.name' });
      // Give an unlocked implementation time to take its stale snapshot.
      expect(await raceAgainstTimer(pinPromise, 300)).toBe('blocked');

      const fieldPaths = row!.fieldPaths as Record<string, { paths: Array<Record<string, unknown>>; conflictCount: number }>;
      fieldPaths['title']!.paths.push({
        path: '$.altName', source: 'meta', confidence: 0.7,
        hits: 1, misses: 0, lastValue: 'Kallax', lastUsedAt: new Date().toISOString(),
      });
      await tx
        .update(domainIntelligence)
        .set({ fieldPaths, updatedAt: new Date() })
        .where(eq(domainIntelligence.id, row!.id));
    });

    expect(await pinPromise!).toBe(true);
    const cache = await lookupDomainCache(DOMAIN, PAGE_TYPE);
    const titlePaths = cache!.fieldPaths['title']!.paths;
    // Both survive: the concurrent writer's new path AND the pin.
    expect(titlePaths.map((p) => p.path).sort()).toEqual(['$.altName', '$.name']);
    expect(titlePaths.find((p) => p.path === '$.name')!.pinned).toBe(true);
  });

  it('saveDomainCache blocks while another transaction holds the row', async () => {
    let savePromise: Promise<void>;
    await db.transaction(async (tx) => {
      await tx
        .select({ id: domainIntelligence.id })
        .from(domainIntelligence)
        .where(and(eq(domainIntelligence.domain, DOMAIN), eq(domainIntelligence.pageType, PAGE_TYPE)))
        .for('update');

      savePromise = seedRow();
      expect(await raceAgainstTimer(savePromise, 300)).toBe('blocked');
    });

    await savePromise!;
    const cache = await lookupDomainCache(DOMAIN, PAGE_TYPE);
    expect(cache!.totalRuns).toBe(2);
  });

  it('a pin set mid-save is not lost: the save merges onto the pinned row', async () => {
    // The lost-update scenario itself, serialized by the lock: with the row
    // held FOR UPDATE, pin then save; the save's read happens after the pin's
    // commit, so its whole-blob write carries the pin forward.
    await pinFieldPath({ domain: DOMAIN, pageType: PAGE_TYPE, field: 'title', path: '$.name' });
    await seedRow();
    const cache = await lookupDomainCache(DOMAIN, PAGE_TYPE);
    expect(cache!.fieldPaths['title']!.paths[0]!.pinned).toBe(true);
  });
});
