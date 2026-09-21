import { describe, it, expect, afterEach, vi } from 'vitest';
import { TRPCError } from '@trpc/server';
import { ZodError } from 'zod';
import { eq } from 'drizzle-orm';
import { db, sources, sourceVerifications } from '@robot/db';
import { VERIFY_STALL_MS } from '@robot/scraper';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';

// `sources.findProductPages` launches a real browser via `withBrowserSession`
// — stubbed here (same pattern sources.test.ts uses for `@robot/browser`) so
// this file never launches Chromium or hits the network. `vi.mock` calls are
// hoisted above imports by vitest, so `appRouter`'s transitive import of
// `../browser-session.js` already sees this mock.
const { withBrowserSessionMock } = vi.hoisted(() => ({ withBrowserSessionMock: vi.fn() }));
vi.mock('../browser-session.js', () => ({ withBrowserSession: withBrowserSessionMock }));

afterEach(() => {
  withBrowserSessionMock.mockReset();
});

const createCaller = createCallerFactory(appRouter);
const caller = createCaller({ db, session: null });

function expectZodValidationError(err: unknown): asserts err is TRPCError {
  if (!(err instanceof TRPCError)) throw new Error(`expected TRPCError, got ${err}`);
  if (!(err.cause instanceof ZodError)) throw new Error(`expected ZodError cause, got ${err.cause}`);
}

describe('sources.updateBinding', () => {
  it('keeps existing field keys matched by key, adds new contract fields, and bumps updatedAt', async () => {
    const urls = [
      'https://test-schema-update.example.com/p/1',
      'https://test-schema-update.example.com/p/2',
      'https://test-schema-update.example.com/p/3',
    ];
    const f = await createProjectWithSource(caller, {
      tag: 'schema-update',
      urls,
      fields: [{ name: 'Price', type: 'money', description: 'orig' }],
      expected: { Price: { [urls[0]!]: '1.00', [urls[1]!]: '2.00', [urls[2]!]: '3.00' } },
    });
    try {
      const before = await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId) });

      await caller.datasets.addField({ datasetId: f.datasetId, name: 'Brand', type: 'text' });

      const updated = await caller.sources.updateBinding({
        sourceId: f.sourceId,
        urls,
        descriptions: { [f.keys.Price!]: 'renamed', brand: 'the brand' },
        expected: {
          [f.keys.Price!]: { [urls[0]!]: '1.00', [urls[1]!]: '2.00', [urls[2]!]: '3.00' },
          brand: { [urls[0]!]: 'Acme', [urls[1]!]: 'Acme', [urls[2]!]: 'Acme' },
        },
      });

      const fields = updated!.schemaDefinition as Array<{ key: string; name: string; description: string }>;
      const price = fields.find((fl) => fl.key === 'price');
      expect(price).toBeDefined();
      expect(price!.description).toBe('renamed');
      const brand = fields.find((fl) => fl.name === 'Brand');
      expect(brand).toBeDefined();
      expect(brand!.key).toBe('brand');
      expect(brand!.description).toBe('the brand');
      expect(updated!.updatedAt.getTime()).toBeGreaterThan(before!.updatedAt.getTime());

      const persisted = await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId) });
      expect(persisted!.schemaDefinition).toEqual(fields);
    } finally {
      await f.cleanup();
    }
  });

  it('refuses while a verification is in flight (completed_at IS NULL) — PRECONDITION_FAILED', async () => {
    const urls = [
      'https://test-schema-update-inflight.example.com/p/1',
      'https://test-schema-update-inflight.example.com/p/2',
      'https://test-schema-update-inflight.example.com/p/3',
    ];
    const f = await createProjectWithSource(caller, {
      tag: 'schema-update-inflight',
      urls,
      fields: [{ name: 'Price', type: 'money', description: 'x' }],
      expected: { Price: { [urls[0]!]: '1.00', [urls[1]!]: '2.00', [urls[2]!]: '3.00' } },
    });
    try {
      await db.insert(sourceVerifications).values({
        sourceId: f.sourceId,
        definitionHash: 'deadbeef',
        completedAt: null,
      });

      await expect(
        caller.sources.updateBinding({
          sourceId: f.sourceId,
          urls,
          descriptions: { [f.keys.Price!]: 'x' },
          expected: { [f.keys.Price!]: { [urls[0]!]: '1.00', [urls[1]!]: '2.00', [urls[2]!]: '3.00' } },
        }),
      ).rejects.toThrow(/verification.*(in flight|flight)/i);

      // The schema must be untouched by the refused update.
      const after = await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId) });
      expect((after!.schemaDefinition as Array<{ name: string }>)[0]!.name).toBe('Price');
    } finally {
      await f.cleanup();
    }
  });

  it('allows updateBinding once the in-flight verification is completed', async () => {
    const urls = [
      'https://test-schema-update-completed.example.com/p/1',
      'https://test-schema-update-completed.example.com/p/2',
      'https://test-schema-update-completed.example.com/p/3',
    ];
    const f = await createProjectWithSource(caller, {
      tag: 'schema-update-completed',
      urls,
      fields: [{ name: 'Price', type: 'money', description: 'x' }],
      expected: { Price: { [urls[0]!]: '1.00', [urls[1]!]: '2.00', [urls[2]!]: '3.00' } },
    });
    try {
      await db.insert(sourceVerifications).values({
        sourceId: f.sourceId,
        definitionHash: 'deadbeef',
        completedAt: new Date(),
      });

      const updated = await caller.sources.updateBinding({
        sourceId: f.sourceId,
        urls,
        descriptions: { [f.keys.Price!]: 'still fine' },
        expected: { [f.keys.Price!]: { [urls[0]!]: '1.00', [urls[1]!]: '2.00', [urls[2]!]: '3.00' } },
      });
      expect((updated!.schemaDefinition as Array<{ description: string }>)[0]!.description).toBe('still fine');
    } finally {
      await f.cleanup();
    }
  });

  // Correction round, item 2: the C1 wave taught the Schema screen to show a
  // stalled verification with an EDITABLE grid — but this guard still refused
  // every save, so a crashed api-server locked the schema out of editing for
  // good. `updateBinding` applies the same stall rule `verify` does.
  it('closes a stalled in-flight verification and saves anyway', async () => {
    const urls = [
      'https://test-schema-update-stalled.example.com/p/1',
      'https://test-schema-update-stalled.example.com/p/2',
      'https://test-schema-update-stalled.example.com/p/3',
    ];
    const f = await createProjectWithSource(caller, {
      tag: 'schema-update-stalled',
      urls,
      fields: [{ name: 'Price', type: 'money', description: 'x' }],
      expected: { Price: { [urls[0]!]: '1.00', [urls[1]!]: '2.00', [urls[2]!]: '3.00' } },
    });
    try {
      const [stalled] = await db.insert(sourceVerifications).values({
        sourceId: f.sourceId,
        definitionHash: 'deadbeef',
        // 20 minutes old — past VERIFY_STALL_MS (15), so a crash leftover.
        startedAt: new Date(Date.now() - VERIFY_STALL_MS - 5 * 60_000),
        completedAt: null,
      }).returning({ id: sourceVerifications.id });

      const updated = await caller.sources.updateBinding({
        sourceId: f.sourceId,
        urls,
        descriptions: { [f.keys.Price!]: 'edited past the stalled run' },
        expected: { [f.keys.Price!]: { [urls[0]!]: '1.00', [urls[1]!]: '2.00', [urls[2]!]: '3.00' } },
      });
      expect((updated!.schemaDefinition as Array<{ description: string }>)[0]!.description)
        .toBe('edited past the stalled run');

      // ...and the dead row is closed out, not left to wedge the Source again.
      const row = await db.query.sourceVerifications.findFirst({
        where: eq(sourceVerifications.id, stalled!.id),
      });
      expect(row!.errorMessage).toBe('stalled');
      expect(row!.completedAt).not.toBeNull();
    } finally {
      await f.cleanup();
    }
  });

  it('throws NOT_FOUND for an unknown sourceId', async () => {
    const urls = ['https://test-schema-update-missing.example.com/p/1', 'https://test-schema-update-missing.example.com/p/2', 'https://test-schema-update-missing.example.com/p/3'];
    await expect(
      caller.sources.updateBinding({
        sourceId: '00000000-0000-0000-0000-000000000000',
        urls,
        descriptions: { price: 'x' },
        expected: { price: { [urls[0]!]: '1.00', [urls[1]!]: '2.00', [urls[2]!]: '3.00' } },
      }),
    ).rejects.toThrow(/not found/i);
  });
});

describe('sources.findProductPages', () => {
  it('captures the listing page (no AI) and returns the ranked product links', async () => {
    const captureMock = vi.fn().mockResolvedValue({ html: '<html></html>' });
    const setContentEvaluateMock = vi.fn().mockResolvedValue([
      { href: '/p/air-1-123456789012', text: 'Air 1' },
      { href: '/p/air-2-123456789013', text: 'Air 2' },
      { href: '/c/shoes', text: 'Shoes' },
    ]);
    withBrowserSessionMock.mockImplementation(async (fn: (browser: unknown) => Promise<unknown>) =>
      fn({ capture: captureMock, setContentEvaluate: setContentEvaluateMock }),
    );

    const result = await caller.sources.findProductPages({ listingUrl: 'https://test-find-products.example.com/c/shoes' });

    expect(result.urls).toEqual([
      'https://test-find-products.example.com/p/air-1-123456789012',
      'https://test-find-products.example.com/p/air-2-123456789013',
    ]);
    expect(withBrowserSessionMock).toHaveBeenCalledTimes(1);
    expect(captureMock).toHaveBeenCalledWith('https://test-find-products.example.com/c/shoes', expect.objectContaining({ interceptNetworkRequests: false }));
    expect(setContentEvaluateMock).toHaveBeenCalledWith('<html></html>', expect.any(String));
  });

  it('rejects a non-URL listingUrl', async () => {
    try {
      await caller.sources.findProductPages({ listingUrl: 'not-a-url' });
      throw new Error('should have thrown');
    } catch (err) {
      expectZodValidationError(err);
    }
  });

  // Important defect (review round 1): `z.string().url()` alone accepts any
  // scheme the WHATWG URL parser recognizes, so a `file://` (or `javascript:`,
  // `data:`, ...) listingUrl would have reached `withBrowserSession` and been
  // handed to a real browser to navigate to. `httpUrl`'s refine must reject it
  // during input parsing, before the browser session is ever opened.
  it('rejects a file:// listingUrl as BAD_REQUEST, without ever calling withBrowserSession', async () => {
    try {
      await caller.sources.findProductPages({ listingUrl: 'file:///etc/passwd' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe('BAD_REQUEST');
    }
    expect(withBrowserSessionMock).not.toHaveBeenCalled();
  });
});

describe('sources.listByProject — schema columns', () => {
  it('includes schemaDefinition, verificationSet, driftedFields', async () => {
    const urls = [
      'https://test-schema-list.example.com/p/1',
      'https://test-schema-list.example.com/p/2',
      'https://test-schema-list.example.com/p/3',
    ];
    const f = await createProjectWithSource(caller, {
      tag: 'schema-list',
      urls,
      fields: [{ name: 'Price', type: 'money', description: 'x' }],
      expected: { Price: { [urls[0]!]: '1.00', [urls[1]!]: '2.00', [urls[2]!]: '3.00' } },
    });
    try {
      const list = await caller.sources.listByProject({ orgSlug: 'default', projectSlug: f.projectSlug });
      const row = list.find((s) => s.id === f.sourceId);
      expect(row).toBeDefined();
      expect(row!.schemaDefinition).toEqual([
        { key: 'price', name: 'Price', type: 'money', description: 'x', concept: 'price' },
      ]);
      expect((row as { verificationSet: unknown }).verificationSet).toBeDefined();
      expect((row as { driftedFields: unknown }).driftedFields).toBeNull();
    } finally {
      await f.cleanup();
    }
  });
});

describe('appRouter shape', () => {
  it('exposes updateBinding/findProductPages on sources', () => {
    expect(typeof caller.sources.updateBinding).toBe('function');
    expect(typeof caller.sources.findProductPages).toBe('function');
  });
});
