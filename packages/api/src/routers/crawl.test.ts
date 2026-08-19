import { describe, it, expect, afterEach } from 'vitest';
import { TRPCError } from '@trpc/server';
import { ZodError } from 'zod';
import { eq } from 'drizzle-orm';
import { db, sources } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';

const createCaller = createCallerFactory(appRouter);
const caller = createCaller({ db });

const CRAWL_TEST_SLUG_PREFIX = 'test-crawl-';

afterEach(async () => {
  await db.delete(sources).where(eq(sources.slug, `${CRAWL_TEST_SLUG_PREFIX}no-inputset`));
});

describe('crawlRouter.plan', () => {
  it('rejects a missing sourceId', async () => {
    try {
      await caller.crawl.plan({} as never);
      throw new Error('should have thrown');
    } catch (err) {
      if (!(err instanceof TRPCError)) throw new Error(`expected TRPCError, got ${err}`);
      if (!(err.cause instanceof ZodError)) throw new Error(`expected ZodError cause, got ${err.cause}`);
    }
  });

  it('rejects a non-uuid sourceId', async () => {
    try {
      await caller.crawl.plan({ sourceId: 'not-a-uuid' });
      throw new Error('should have thrown');
    } catch (err) {
      if (!(err instanceof TRPCError)) throw new Error(`expected TRPCError, got ${err}`);
    }
  });

  it('reports a source that does not exist rather than creating an orphan run', async () => {
    await expect(
      caller.crawl.plan({ sourceId: '00000000-0000-0000-0000-000000000000' }),
    ).rejects.toThrow(/not found/i);
  });

  it('rejects a source with no InputSet to plan from', async () => {
    // isSandbox: true satisfies the sources_non_sandbox_requires_dataset CHECK
    // without needing a project/dataset chain — inputSetId is left null, which
    // is exactly the precondition this test exercises.
    const [source] = await db.insert(sources).values({
      name: 'crawl test source (no input set)',
      slug: `${CRAWL_TEST_SLUG_PREFIX}no-inputset`,
      country: 'us',
      isSandbox: true,
    }).returning({ id: sources.id });

    try {
      await caller.crawl.plan({ sourceId: source.id });
      throw new Error('should have thrown');
    } catch (err) {
      if (!(err instanceof TRPCError)) throw new Error(`expected TRPCError, got ${err}`);
      expect(err.code).toBe('PRECONDITION_FAILED');
    }
  });
});
