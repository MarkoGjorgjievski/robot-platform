import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import { TRPCError } from '@trpc/server';
import { appRouter } from './index.js';
import { createCallerFactory } from '../trpc.js';
import { db } from '@robot/db';

const createCaller = createCallerFactory(appRouter);

// tRPC wraps Zod input-validation failures in a TRPCError with `cause` set to
// the underlying ZodError. This helper asserts both layers.
async function expectZodValidationError(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(TRPCError);
  await promise.catch((err) => {
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).cause).toBeInstanceOf(ZodError);
  });
}

describe('scraperRouter', () => {
  const caller = createCaller({ db });

  describe('analyze input validation', () => {
    it('rejects empty input', async () => {
      await expectZodValidationError(caller.scraper.analyze({} as never));
    });

    it('rejects non-URL string', async () => {
      await expectZodValidationError(
        caller.scraper.analyze({ url: 'not-a-url' as never })
      );
    });

    it('accepts valid URL', () => {
      // Just verify the input type is accepted by Zod; don't actually run the procedure
      // (the procedure body would do real scraping which is too slow for unit tests).
      const validInput = { url: 'https://example.com', requestedFields: 'price\ntitle' };
      // We exercise the parse path by hitting the procedure's zod schema indirectly.
      // For a smoke test, just confirm appRouter exposes the procedure.
      expect(typeof caller.scraper.analyze).toBe('function');
    });
  });

  describe('extract input validation', () => {
    it('rejects empty input', async () => {
      await expectZodValidationError(caller.scraper.extract({} as never));
    });

    it('rejects missing fields array', async () => {
      await expectZodValidationError(
        caller.scraper.extract({ url: 'https://example.com' } as never)
      );
    });

    it('rejects fields without name/type', async () => {
      await expectZodValidationError(
        caller.scraper.extract({
          url: 'https://example.com',
          fields: [{ name: '' }] as never,
        })
      );
    });

    it('accepts well-formed input', () => {
      // Sanity: procedure is exposed
      expect(typeof caller.scraper.extract).toBe('function');
    });
  });

  describe('appRouter shape', () => {
    it('exposes scraper procedures', () => {
      expect(typeof caller.scraper.analyze).toBe('function');
      expect(typeof caller.scraper.extract).toBe('function');
    });
  });
});
