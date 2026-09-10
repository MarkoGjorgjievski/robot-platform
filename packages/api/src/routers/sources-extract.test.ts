import { describe, it, expect, afterEach, vi } from 'vitest';
import { TRPCError } from '@trpc/server';
import { ZodError } from 'zod';
import { db } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';

// The Extract tab's free per-row listing check. Like `sources.findProductPages`
// (sources-schema.test.ts), it launches a real browser via `withBrowserSession`
// — stubbed here so this file never launches Chromium or hits the network.
// `vi.mock` calls are hoisted above imports by vitest, so `appRouter`'s
// transitive import of `../browser-session.js` already sees this mock.
const { withBrowserSessionMock } = vi.hoisted(() => ({ withBrowserSessionMock: vi.fn() }));
vi.mock('../browser-session.js', () => ({ withBrowserSession: withBrowserSessionMock }));

afterEach(() => {
  withBrowserSessionMock.mockReset();
});

const createCaller = createCallerFactory(appRouter);
const caller = createCaller({ db });

function expectZodValidationError(err: unknown): asserts err is TRPCError {
  if (!(err instanceof TRPCError)) throw new Error(`expected TRPCError, got ${err}`);
  if (!(err.cause instanceof ZodError)) throw new Error(`expected ZodError cause, got ${err.cause}`);
}

describe('sources.checkListingPage', () => {
  it('captures the listing page (no AI) and reports product link count, sample, and pagerSeen', async () => {
    const html = '<html><head><link rel="next" href="?page=2"></head><body></body></html>';
    const anchors = Array.from({ length: 12 }, (_, i) => ({ href: `/p/air-${i}-123456789012`, text: `Air ${i}` }));
    const captureMock = vi.fn().mockResolvedValue({ html });
    const setContentEvaluateMock = vi.fn().mockResolvedValue(anchors);
    withBrowserSessionMock.mockImplementation(async (fn: (browser: unknown) => Promise<unknown>) =>
      fn({ capture: captureMock, setContentEvaluate: setContentEvaluateMock }),
    );

    const result = await caller.sources.checkListingPage({ listingUrl: 'https://test-check-listing.example.com/c/shoes' });

    expect(result.productLinks).toBe(12);
    expect(result.pagerSeen).toBe(true);
    expect(result.sample).toHaveLength(10);
    expect(withBrowserSessionMock).toHaveBeenCalledTimes(1);
    expect(captureMock).toHaveBeenCalledWith('https://test-check-listing.example.com/c/shoes', expect.objectContaining({ interceptNetworkRequests: false }));
    expect(setContentEvaluateMock).toHaveBeenCalledWith(html, expect.any(String));
  });

  it('reports pagerSeen false when the captured page has no pagination markup', async () => {
    const html = '<html><body>no pager</body></html>';
    const anchors = [
      { href: '/p/air-1-123456789012', text: 'Air 1' },
      { href: '/p/air-2-123456789013', text: 'Air 2' },
    ];
    withBrowserSessionMock.mockImplementation(async (fn: (browser: unknown) => Promise<unknown>) =>
      fn({ capture: vi.fn().mockResolvedValue({ html }), setContentEvaluate: vi.fn().mockResolvedValue(anchors) }),
    );

    const result = await caller.sources.checkListingPage({ listingUrl: 'https://test-check-listing-nopager.example.com/c/shoes' });

    expect(result.productLinks).toBe(2);
    expect(result.pagerSeen).toBe(false);
  });

  it('rejects a non-URL listingUrl', async () => {
    try {
      await caller.sources.checkListingPage({ listingUrl: 'not-a-url' });
      throw new Error('should have thrown');
    } catch (err) {
      expectZodValidationError(err);
    }
  });

  it('rejects a file:// listingUrl as BAD_REQUEST, without ever calling withBrowserSession', async () => {
    try {
      await caller.sources.checkListingPage({ listingUrl: 'file:///x' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe('BAD_REQUEST');
    }
    expect(withBrowserSessionMock).not.toHaveBeenCalled();
  });
});
