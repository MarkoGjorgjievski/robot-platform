import { describe, it, expect, afterEach, vi } from 'vitest';
import { TRPCError } from '@trpc/server';
import { ZodError } from 'zod';
import { eq } from 'drizzle-orm';
import { db, sources } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';

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

describe('sources.setListingPages', () => {
  it('writes the urls as input-set rows, sets listing_to_detail, seeds the all/all budget, and marks parameters.inputMode', async () => {
    const f = await createProjectWithSource(caller, { tag: 'set-listing', fields: [{ name: 'Price', type: 'money' }] });
    try {
      const listingUrls = ['https://test-set-listing.example.com/c/shoes', 'https://test-set-listing.example.com/c/bags'];
      const result = await caller.sources.setListingPages({ sourceId: f.sourceId, urls: listingUrls });
      expect(result).toEqual({ count: 2 });

      const row = await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId), with: { inputSet: true } });
      expect(row?.listingMode).toBe('listing_to_detail');
      expect(row?.inputSet?.rows).toEqual(listingUrls.map((url) => ({ url })));
      expect(row?.budget).toEqual({ max_items: 'all', max_pages: 'all', mode: 'all' });
      expect((row?.parameters as { inputMode?: string } | null)?.inputMode).toBe('listing');
    } finally {
      await f.cleanup();
    }
  });

  it('does not overwrite an already-seeded budget', async () => {
    const f = await createProjectWithSource(caller, { tag: 'set-listing-budget-kept', fields: [{ name: 'Price', type: 'money' }] });
    try {
      await db.update(sources).set({ budget: { max_items: 5, max_pages: 1, mode: 'first_n' } }).where(eq(sources.id, f.sourceId));
      await caller.sources.setListingPages({ sourceId: f.sourceId, urls: ['https://test-set-listing-budget-kept.example.com/c/shoes'] });
      const row = await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId) });
      expect(row?.budget).toEqual({ max_items: 5, max_pages: 1, mode: 'first_n' });
    } finally {
      await f.cleanup();
    }
  });

  it('refuses a listing url on a different host than the binding\'s proof pages', async () => {
    const urls = ['https://test-set-listing-diffhost.example.com/p/1', 'https://test-set-listing-diffhost.example.com/p/2', 'https://test-set-listing-diffhost.example.com/p/3'];
    const f = await createProjectWithSource(caller, {
      tag: 'set-listing-diffhost',
      urls,
      fields: [{ name: 'Price', type: 'money' }],
      expected: { Price: { [urls[0]!]: '1', [urls[1]!]: '2', [urls[2]!]: '3' } },
    });
    try {
      const offHost = 'https://other-host.example.com/c/all';
      await expect(caller.sources.setListingPages({ sourceId: f.sourceId, urls: [offHost] })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(caller.sources.setListingPages({ sourceId: f.sourceId, urls: [offHost] })).rejects.toThrow(new RegExp(offHost.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    } finally {
      await f.cleanup();
    }
  });

  it('refuses two urls on different hosts when there is no binding yet', async () => {
    const f = await createProjectWithSource(caller, { tag: 'set-listing-mixed', fields: [{ name: 'Price', type: 'money' }] });
    try {
      await expect(
        caller.sources.setListingPages({
          sourceId: f.sourceId,
          urls: ['https://test-set-listing-mixed.example.com/c/shoes', 'https://other-host.example.com/c/bags'],
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    } finally {
      await f.cleanup();
    }
  });

  it('refuses once the source is confirmed on a different mode', async () => {
    const f = await createProjectWithSource(caller, { tag: 'set-listing-confirmed', fields: [{ name: 'Price', type: 'money' }] });
    try {
      await caller.sources.setProductUrls({ sourceId: f.sourceId, urls: ['https://test-set-listing-confirmed.example.com/p/1'] });
      await db.update(sources).set({ confirmedAt: new Date() }).where(eq(sources.id, f.sourceId));
      await expect(
        caller.sources.setListingPages({ sourceId: f.sourceId, urls: ['https://test-set-listing-confirmed.example.com/c/all'] }),
      ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    } finally {
      await f.cleanup();
    }
  });
});

describe('sources.setProductUrls', () => {
  it('accepts same-host urls, drops an off-host url into skipped, and sets detail mode', async () => {
    const f = await createProjectWithSource(caller, { tag: 'set-product', fields: [{ name: 'Price', type: 'money' }] });
    try {
      const host = 'test-set-product.example.com';
      const offHost = 'https://other-host.example.com/p/3';
      const urls = [`https://${host}/p/1`, `https://${host}/p/2`, offHost];
      const result = await caller.sources.setProductUrls({ sourceId: f.sourceId, urls });
      expect(result).toEqual({ accepted: 2, skipped: [offHost] });

      const row = await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId), with: { inputSet: true } });
      expect(row?.listingMode).toBe('detail');
      expect(row?.inputSet?.rows).toEqual([{ url: urls[0] }, { url: urls[1] }]);
      expect((row?.parameters as { inputMode?: string } | null)?.inputMode).toBe('detail');
    } finally {
      await f.cleanup();
    }
  });

  it('refuses once the source is confirmed on a different mode', async () => {
    const f = await createProjectWithSource(caller, { tag: 'set-product-confirmed', fields: [{ name: 'Price', type: 'money' }] });
    try {
      await caller.sources.setListingPages({ sourceId: f.sourceId, urls: ['https://test-set-product-confirmed.example.com/c/all'] });
      await db.update(sources).set({ confirmedAt: new Date() }).where(eq(sources.id, f.sourceId));
      await expect(
        caller.sources.setProductUrls({ sourceId: f.sourceId, urls: ['https://test-set-product-confirmed.example.com/p/1'] }),
      ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    } finally {
      await f.cleanup();
    }
  });
});

describe('sources.update budget', () => {
  it('stores the given budget as given', async () => {
    const f = await createProjectWithSource(caller, { tag: 'update-budget', fields: [{ name: 'Price', type: 'money' }] });
    try {
      const updated = await caller.sources.update({ id: f.sourceId, budget: { max_items: 40, max_pages: 'all' } });
      expect(updated.budget).toEqual({ max_items: 40, max_pages: 'all' });
    } finally {
      await f.cleanup();
    }
  });
});
