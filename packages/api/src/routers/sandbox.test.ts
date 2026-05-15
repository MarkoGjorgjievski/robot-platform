import { describe, it, expect, afterEach } from 'vitest';
import { TRPCError } from '@trpc/server';
import { ZodError } from 'zod';
import { eq, like } from 'drizzle-orm';
import { db, sources, inputSets } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';

const createCaller = createCallerFactory(appRouter);
const caller = createCaller({ db });

const SANDBOX_TEST_PREFIX = 'test-sb-';

function expectZodValidationError(err: unknown): asserts err is TRPCError {
  if (!(err instanceof TRPCError)) throw new Error(`expected TRPCError, got ${err}`);
  if (!(err.cause instanceof ZodError)) throw new Error(`expected ZodError cause, got ${err.cause}`);
}

afterEach(async () => {
  const testSources = await db.select({ id: sources.id, inputSetId: sources.inputSetId })
    .from(sources)
    .where(like(sources.slug, `${SANDBOX_TEST_PREFIX}%`));
  for (const s of testSources) {
    await db.delete(sources).where(eq(sources.id, s.id));
    if (s.inputSetId) {
      await db.delete(inputSets).where(eq(inputSets.id, s.inputSetId));
    }
  }
});

describe('sandboxRouter', () => {
  describe('create input validation', () => {
    it('rejects empty input', async () => {
      try {
        await caller.sandbox.create({} as never);
        throw new Error('should have thrown');
      } catch (err) {
        expectZodValidationError(err);
      }
    });

    it('rejects non-URL string', async () => {
      try {
        await caller.sandbox.create({ url: 'not-a-url' });
        throw new Error('should have thrown');
      } catch (err) {
        expectZodValidationError(err);
      }
    });
  });

  describe('get input validation', () => {
    it('rejects missing slug', async () => {
      try {
        await caller.sandbox.get({} as never);
        throw new Error('should have thrown');
      } catch (err) {
        expectZodValidationError(err);
      }
    });

    it('returns null for unknown slug', async () => {
      const result = await caller.sandbox.get({ slug: 'definitely-not-a-real-slug-xyz' });
      expect(result).toBeNull();
    });
  });

  describe('extract input validation', () => {
    it('rejects missing slug', async () => {
      try {
        await caller.sandbox.extract({ fields: [] } as never);
        throw new Error('should have thrown');
      } catch (err) {
        expectZodValidationError(err);
      }
    });

    it('rejects missing fields array', async () => {
      try {
        await caller.sandbox.extract({ slug: 'foo' } as never);
        throw new Error('should have thrown');
      } catch (err) {
        expectZodValidationError(err);
      }
    });
  });

  describe('analyze input validation', () => {
    it('rejects missing slug', async () => {
      try {
        await caller.sandbox.analyze({} as never);
        throw new Error('should have thrown');
      } catch (err) {
        expectZodValidationError(err);
      }
    });
  });

  describe('appRouter shape', () => {
    it('exposes all sandbox procedures', () => {
      expect(typeof caller.sandbox.create).toBe('function');
      expect(typeof caller.sandbox.list).toBe('function');
      expect(typeof caller.sandbox.get).toBe('function');
      expect(typeof caller.sandbox.analyze).toBe('function');
      expect(typeof caller.sandbox.extract).toBe('function');
    });
  });
});
