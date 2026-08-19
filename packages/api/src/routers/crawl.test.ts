import { describe, it, expect } from 'vitest';
import { TRPCError } from '@trpc/server';
import { ZodError } from 'zod';
import { db } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';

const createCaller = createCallerFactory(appRouter);
const caller = createCaller({ db });

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
});
