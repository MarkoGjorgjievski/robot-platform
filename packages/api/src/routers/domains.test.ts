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

describe('domainsRouter', () => {
  describe('listByProject input validation', () => {
    it('rejects empty input', async () => {
      try {
        await caller.domains.listByProject({} as never);
        throw new Error('should have thrown');
      } catch (err) {
        expectZodValidationError(err);
      }
    });

    it('returns empty array for unknown project', async () => {
      const result = await caller.domains.listByProject({ orgSlug: 'nope', projectSlug: 'nope' });
      expect(result).toEqual([]);
    });
  });

  describe('detailByProject input validation', () => {
    it('rejects missing domain', async () => {
      try {
        await caller.domains.detailByProject({ orgSlug: 'a', projectSlug: 'b' } as never);
        throw new Error('should have thrown');
      } catch (err) {
        expectZodValidationError(err);
      }
    });

    it('returns empty sources for unknown project/domain', async () => {
      const result = await caller.domains.detailByProject({
        orgSlug: 'nope', projectSlug: 'nope', domain: 'example.com'
      });
      expect(result.sources).toEqual([]);
    });
  });

  describe('intelligenceList', () => {
    it('returns an array (smoke)', async () => {
      const result = await caller.domains.intelligenceList();
      expect(Array.isArray(result)).toBe(true);
      for (const row of result) {
        expect(typeof row.domain).toBe('string');
        expect(Array.isArray(row.pageTypes)).toBe(true);
        expect(typeof row.successRate).toBe('number');
        expect(typeof row.fieldCount).toBe('number');
      }
    });

    it('is sorted by lastVerifiedAt descending', async () => {
      const result = await caller.domains.intelligenceList();
      for (let i = 1; i < result.length; i++) {
        expect(new Date(result[i - 1].lastVerifiedAt).getTime())
          .toBeGreaterThanOrEqual(new Date(result[i].lastVerifiedAt).getTime());
      }
    });
  });

  describe('intelligenceDetail', () => {
    it('rejects empty domain', async () => {
      try {
        await caller.domains.intelligenceDetail({ domain: '' });
        throw new Error('should have thrown');
      } catch (err) {
        expectZodValidationError(err);
      }
    });

    it('returns empty pageTypes + sources for an unknown domain', async () => {
      const result = await caller.domains.intelligenceDetail({ domain: 'no-such-domain.example' });
      expect(result.domain).toBe('no-such-domain.example');
      expect(result.pageTypes).toEqual([]);
      expect(result.sources).toEqual([]);
    });
  });
});
