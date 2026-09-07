import { describe, it, expect, afterEach, vi } from 'vitest';
import { TRPCError } from '@trpc/server';
import { ZodError } from 'zod';
import { eq } from 'drizzle-orm';
import { db, sources, inputSets, datasets, sourceVerifications } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';
import { prepareSchema, schemaProblems } from '../verify/schema-input.js';

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
const caller = createCaller({ db });

function expectZodValidationError(err: unknown): asserts err is TRPCError {
  if (!(err instanceof TRPCError)) throw new Error(`expected TRPCError, got ${err}`);
  if (!(err.cause instanceof ZodError)) throw new Error(`expected ZodError cause, got ${err.cause}`);
}

/** Deletes a Source created by createWithSchema, plus its InputSet — mirrors
 *  sources.test.ts's cleanupSource. `source_verifications` rows cascade with
 *  the Source (onDelete: 'cascade'), so no separate cleanup is needed there. */
async function cleanupSource(sourceId: string): Promise<void> {
  const source = await db.query.sources.findFirst({
    where: eq(sources.id, sourceId),
    columns: { inputSetId: true },
  });
  await db.delete(sources).where(eq(sources.id, sourceId));
  if (source?.inputSetId) {
    await db.delete(inputSets).where(eq(inputSets.id, source.inputSetId));
  }
}

// ─── Pure: prepareSchema / schemaProblems ──────────────────────────────────

const U = ['https://shop.example/p/1', 'https://shop.example/p/2', 'https://shop.example/p/3'];
const base = {
  urls: U,
  fields: [{ name: 'Price', type: 'money' as const, description: 'green' }],
  expected: { Price: { [U[0]!]: '1', [U[1]!]: '2', [U[2]!]: '3' } },
};

describe('prepareSchema / schemaProblems', () => {
  it('assigns key and concept', () => {
    const r = prepareSchema(base);
    expect(r.fields[0]).toEqual({ key: 'price', name: 'Price', type: 'money', description: 'green', concept: 'price' });
    expect(r.verificationSet.expected.price).toEqual(base.expected.Price);
    expect(r.hostname).toBe('shop.example');
  });

  it('rejects mixed hostnames, duplicate urls, blank or mistyped cells', () => {
    expect(schemaProblems({ ...base, urls: [U[0]!, U[1]!, 'https://other.example/p'] })).toContain('All URLs must be on the same website');
    expect(schemaProblems({ ...base, urls: [U[0]!, U[0]!, U[2]!] })).toContain('URLs must be different pages');
    expect(schemaProblems({ ...base, expected: { Price: { [U[0]!]: '', [U[1]!]: 'x', [U[2]!]: '3' } } })).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Price @ https://shop.example/p/1: Expected value is required'),
        expect.stringContaining('Price @ https://shop.example/p/2: Not a money amount'),
      ]),
    );
  });

  it('keeps existing keys on update when the name matches by key', () => {
    const existing = [{ key: 'price', name: 'Old', type: 'money' as const, description: 'd', concept: 'price' }];
    const r = prepareSchema(
      { ...base, fields: [{ key: 'price', name: 'Unit cost', type: 'money', description: 'green' }], expected: { price: base.expected.Price! } },
      existing,
    );
    expect(r.fields[0]!.key).toBe('price');
    expect(r.fields[0]!.name).toBe('Unit cost');
  });

  // Controller ruling: a field whose derived key would be the reserved
  // planning key `detail_url` is rejected — keeps the customer branch of
  // `effectiveSchema` free of the listing-crawl planning sentinel.
  it('rejects a field name that derives the reserved planning key "detail_url"', () => {
    const problems = schemaProblems({
      ...base,
      fields: [{ name: 'Detail Url', type: 'text', description: 'x' }],
      expected: { 'Detail Url': { [U[0]!]: 'a', [U[1]!]: 'b', [U[2]!]: 'c' } },
    });
    expect(problems).toContain('Detail Url: field name is reserved');
  });

  it('rejects an explicit key equal to "detail_url" even when the name differs', () => {
    const problems = schemaProblems({
      ...base,
      fields: [{ key: 'detail_url', name: 'Product Link', type: 'url', description: 'x' }],
      expected: { detail_url: { [U[0]!]: 'https://shop.example/p/1', [U[1]!]: 'https://shop.example/p/2', [U[2]!]: 'https://shop.example/p/3' } },
    });
    expect(problems).toContain('Product Link: field name is reserved');
  });

  it('does not accidentally read expected[""] for a field with no key', () => {
    // A stray '' entry in `expected` must never satisfy a keyless field's
    // lookup — only its name should.
    const problems = schemaProblems({
      ...base,
      expected: { '': { [U[0]!]: '1', [U[1]!]: '2', [U[2]!]: '3' }, Price: { [U[0]!]: '1', [U[1]!]: '2', [U[2]!]: '3' } },
    });
    expect(problems).toEqual([]);
  });
});

// ─── Integration: createWithSchema / updateSchema / findProductPages ──────

describe('sources.createWithSchema', () => {
  it('creates a detail Source + one-row-per-url InputSet, persisting schemaDefinition + verificationSet, under Scratch', async () => {
    const urls = [
      'https://test-schema-create.example.com/p/1',
      'https://test-schema-create.example.com/p/2',
      'https://test-schema-create.example.com/p/3',
    ];
    const result = await caller.sources.createWithSchema({
      urls,
      fields: [{ name: 'Price', type: 'money', description: 'The price' }],
      expected: { Price: { [urls[0]!]: '9.99', [urls[1]!]: '19.99', [urls[2]!]: '29.99' } },
    });
    try {
      expect(result.projectSlug).toBe('scratch');
      expect(result.sourceId).toBeTruthy();

      const source = await db.query.sources.findFirst({ where: eq(sources.id, result.sourceId) });
      expect(source).toBeDefined();
      expect(source!.listingMode).toBe('detail');
      expect(source!.inputStrategy).toBe('direct');
      expect(source!.urlTemplate).toBe(urls[0]);
      expect(source!.budget).toEqual({});
      expect(source!.schemaDefinition).toEqual([
        { key: 'price', name: 'Price', type: 'money', description: 'The price', concept: 'price' },
      ]);
      expect(source!.verificationSet).toEqual({
        urls,
        expected: { price: { [urls[0]!]: '9.99', [urls[1]!]: '19.99', [urls[2]!]: '29.99' } },
      });

      const dataset = await db.query.datasets.findFirst({ where: eq(datasets.id, source!.datasetId!) });
      expect(dataset!.slug).toBe('scratch');

      const inputSet = await db.query.inputSets.findFirst({ where: eq(inputSets.id, source!.inputSetId!) });
      expect(inputSet!.columns).toEqual([{ name: 'url', primary: true }]);
      expect(inputSet!.rows).toEqual(urls.map((url) => ({ url })));
    } finally {
      await cleanupSource(result.sourceId);
    }
  });

  it('with a listingUrl: InputSet rows are the listing URL only; the three product URLs live only in verificationSet', async () => {
    const listingUrl = 'https://test-schema-create-listing.example.com/c/shoes';
    const urls = [
      'https://test-schema-create-listing.example.com/p/1',
      'https://test-schema-create-listing.example.com/p/2',
      'https://test-schema-create-listing.example.com/p/3',
    ];
    const result = await caller.sources.createWithSchema({
      urls,
      listingUrl,
      fields: [{ name: 'Title', type: 'text', description: 'Product title' }],
      expected: { Title: { [urls[0]!]: 'A', [urls[1]!]: 'B', [urls[2]!]: 'C' } },
    });
    try {
      const source = await db.query.sources.findFirst({ where: eq(sources.id, result.sourceId) });
      expect(source!.listingMode).toBe('listing_to_detail');
      expect(source!.budget).toEqual({ max_items: 40, max_pages: 3, mode: 'first_n' });
      const verificationSet = source!.verificationSet as { urls: string[]; listing_url?: string };
      expect(verificationSet.listing_url).toBe(listingUrl);
      expect(verificationSet.urls).toEqual(urls);

      const inputSet = await db.query.inputSets.findFirst({ where: eq(inputSets.id, source!.inputSetId!) });
      expect(inputSet!.rows).toEqual([{ url: listingUrl }]);
    } finally {
      await cleanupSource(result.sourceId);
    }
  });

  it('rejects invalid input (mixed hostnames) as BAD_REQUEST', async () => {
    await expect(
      caller.sources.createWithSchema({
        urls: ['https://test-schema-bad-a.example.com/p/1', 'https://test-schema-bad-a.example.com/p/2', 'https://test-schema-bad-b.example.com/p/3'],
        fields: [{ name: 'Price', type: 'money', description: 'x' }],
        expected: {
          Price: {
            'https://test-schema-bad-a.example.com/p/1': '1',
            'https://test-schema-bad-a.example.com/p/2': '2',
            'https://test-schema-bad-b.example.com/p/3': '3',
          },
        },
      }),
    ).rejects.toThrow(/same website/i);
  });

  it('rejects a non-URL entry in urls', async () => {
    try {
      await caller.sources.createWithSchema({
        urls: ['not-a-url', 'https://test-schema-bad.example.com/p/2', 'https://test-schema-bad.example.com/p/3'],
        fields: [{ name: 'Price', type: 'money', description: 'x' }],
        expected: { Price: {} },
      } as never);
      throw new Error('should have thrown');
    } catch (err) {
      expectZodValidationError(err);
    }
  });
});

describe('sources.updateSchema', () => {
  it('keeps existing field keys matched by key, derives new ones, and bumps updatedAt', async () => {
    const urls = [
      'https://test-schema-update.example.com/p/1',
      'https://test-schema-update.example.com/p/2',
      'https://test-schema-update.example.com/p/3',
    ];
    const created = await caller.sources.createWithSchema({
      urls,
      fields: [{ name: 'Price', type: 'money', description: 'orig' }],
      expected: { Price: { [urls[0]!]: '1.00', [urls[1]!]: '2.00', [urls[2]!]: '3.00' } },
    });
    try {
      const before = await db.query.sources.findFirst({ where: eq(sources.id, created.sourceId) });

      const updated = await caller.sources.updateSchema({
        sourceId: created.sourceId,
        urls,
        fields: [
          { key: 'price', name: 'Unit Price', type: 'money', description: 'renamed' },
          { name: 'Brand', type: 'text', description: 'the brand' },
        ],
        expected: {
          price: { [urls[0]!]: '1.00', [urls[1]!]: '2.00', [urls[2]!]: '3.00' },
          Brand: { [urls[0]!]: 'Acme', [urls[1]!]: 'Acme', [urls[2]!]: 'Acme' },
        },
      });

      const fields = updated!.schemaDefinition as Array<{ key: string; name: string }>;
      const price = fields.find((f) => f.key === 'price');
      expect(price).toBeDefined();
      expect(price!.name).toBe('Unit Price');
      const brand = fields.find((f) => f.name === 'Brand');
      expect(brand).toBeDefined();
      expect(brand!.key).toBe('brand');
      expect(updated!.updatedAt.getTime()).toBeGreaterThan(before!.updatedAt.getTime());

      const persisted = await db.query.sources.findFirst({ where: eq(sources.id, created.sourceId) });
      expect(persisted!.schemaDefinition).toEqual(fields);
    } finally {
      await cleanupSource(created.sourceId);
    }
  });

  it('refuses while a verification is in flight (completed_at IS NULL) — PRECONDITION_FAILED', async () => {
    const urls = [
      'https://test-schema-update-inflight.example.com/p/1',
      'https://test-schema-update-inflight.example.com/p/2',
      'https://test-schema-update-inflight.example.com/p/3',
    ];
    const created = await caller.sources.createWithSchema({
      urls,
      fields: [{ name: 'Price', type: 'money', description: 'x' }],
      expected: { Price: { [urls[0]!]: '1.00', [urls[1]!]: '2.00', [urls[2]!]: '3.00' } },
    });
    try {
      await db.insert(sourceVerifications).values({
        sourceId: created.sourceId,
        definitionHash: 'deadbeef',
        completedAt: null,
      });

      await expect(
        caller.sources.updateSchema({
          sourceId: created.sourceId,
          urls,
          fields: [{ name: 'Price', type: 'money', description: 'x' }],
          expected: { Price: { [urls[0]!]: '1.00', [urls[1]!]: '2.00', [urls[2]!]: '3.00' } },
        }),
      ).rejects.toThrow(/verification.*(in flight|flight)/i);

      // The schema must be untouched by the refused update.
      const after = await db.query.sources.findFirst({ where: eq(sources.id, created.sourceId) });
      expect((after!.schemaDefinition as Array<{ name: string }>)[0]!.name).toBe('Price');
    } finally {
      await cleanupSource(created.sourceId);
    }
  });

  it('allows updateSchema once the in-flight verification is completed', async () => {
    const urls = [
      'https://test-schema-update-completed.example.com/p/1',
      'https://test-schema-update-completed.example.com/p/2',
      'https://test-schema-update-completed.example.com/p/3',
    ];
    const created = await caller.sources.createWithSchema({
      urls,
      fields: [{ name: 'Price', type: 'money', description: 'x' }],
      expected: { Price: { [urls[0]!]: '1.00', [urls[1]!]: '2.00', [urls[2]!]: '3.00' } },
    });
    try {
      await db.insert(sourceVerifications).values({
        sourceId: created.sourceId,
        definitionHash: 'deadbeef',
        completedAt: new Date(),
      });

      const updated = await caller.sources.updateSchema({
        sourceId: created.sourceId,
        urls,
        fields: [{ name: 'Price', type: 'money', description: 'still fine' }],
        expected: { Price: { [urls[0]!]: '1.00', [urls[1]!]: '2.00', [urls[2]!]: '3.00' } },
      });
      expect((updated!.schemaDefinition as Array<{ description: string }>)[0]!.description).toBe('still fine');
    } finally {
      await cleanupSource(created.sourceId);
    }
  });

  it('throws NOT_FOUND for an unknown sourceId', async () => {
    const urls = ['https://test-schema-update-missing.example.com/p/1', 'https://test-schema-update-missing.example.com/p/2', 'https://test-schema-update-missing.example.com/p/3'];
    await expect(
      caller.sources.updateSchema({
        sourceId: '00000000-0000-0000-0000-000000000000',
        urls,
        fields: [{ name: 'Price', type: 'money', description: 'x' }],
        expected: { Price: { [urls[0]!]: '1.00', [urls[1]!]: '2.00', [urls[2]!]: '3.00' } },
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
});

describe('sources.listByProject — schema columns', () => {
  it('includes schemaDefinition, verificationSet, driftedFields', async () => {
    const urls = [
      'https://test-schema-list.example.com/p/1',
      'https://test-schema-list.example.com/p/2',
      'https://test-schema-list.example.com/p/3',
    ];
    const created = await caller.sources.createWithSchema({
      urls,
      fields: [{ name: 'Price', type: 'money', description: 'x' }],
      expected: { Price: { [urls[0]!]: '1.00', [urls[1]!]: '2.00', [urls[2]!]: '3.00' } },
    });
    try {
      const sourceRow = await db.query.sources.findFirst({
        where: eq(sources.id, created.sourceId),
        with: { dataset: { with: { project: { with: { org: true } } } } },
      });
      const orgSlug = sourceRow!.dataset!.project!.org!.slug;
      const projectSlug = sourceRow!.dataset!.project!.slug;

      const list = await caller.sources.listByProject({ orgSlug, projectSlug });
      const row = list.find((s) => s.id === created.sourceId);
      expect(row).toBeDefined();
      expect(row!.schemaDefinition).toEqual([
        { key: 'price', name: 'Price', type: 'money', description: 'x', concept: 'price' },
      ]);
      expect((row as { verificationSet: unknown }).verificationSet).toBeDefined();
      expect((row as { driftedFields: unknown }).driftedFields).toBeNull();
    } finally {
      await cleanupSource(created.sourceId);
    }
  });
});

describe('appRouter shape', () => {
  it('exposes createWithSchema/updateSchema/findProductPages on sources', () => {
    expect(typeof caller.sources.createWithSchema).toBe('function');
    expect(typeof caller.sources.updateSchema).toBe('function');
    expect(typeof caller.sources.findProductPages).toBe('function');
  });
});
