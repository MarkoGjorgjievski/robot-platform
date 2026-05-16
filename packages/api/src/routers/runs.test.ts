import { describe, it, expect } from 'vitest';
import { TRPCError } from '@trpc/server';
import { ZodError } from 'zod';
import { db } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';

const createCaller = createCallerFactory(appRouter);
const caller = createCaller({ db });

function expectZodValidationError(err: unknown) {
  if (!(err instanceof TRPCError)) throw new Error(`expected TRPCError, got ${err}`);
  if (!(err.cause instanceof ZodError)) throw new Error(`expected ZodError cause, got ${err.cause}`);
}

describe('runsRouter', () => {
  describe('getWithDetails input validation', () => {
    it('rejects missing id', async () => {
      try {
        await caller.runs.getWithDetails({} as never);
        throw new Error('should have thrown');
      } catch (err) {
        expectZodValidationError(err);
      }
    });

    it('rejects non-uuid string', async () => {
      try {
        await caller.runs.getWithDetails({ id: 'not-a-uuid' });
        throw new Error('should have thrown');
      } catch (err) {
        expectZodValidationError(err);
      }
    });

    it('returns null for unknown run id', async () => {
      const result = await caller.runs.getWithDetails({ id: '00000000-0000-0000-0000-000000000000' });
      expect(result).toBeNull();
    });
  });

  describe('listBySource', () => {
    it('returns empty array for unknown sourceId', async () => {
      const result = await caller.runs.listBySource({ sourceId: '00000000-0000-0000-0000-000000000000' });
      expect(result).toEqual([]);
    });
  });
});
