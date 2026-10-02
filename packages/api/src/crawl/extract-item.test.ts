// packages/api/src/crawl/extract-item.test.ts
import { describe, it, expect, vi } from 'vitest';
import type { IBrowser, PageCapture } from '@robot/browser';
import type { VerifiedField, VerifiedExtractionResult, VariantRunPlan } from '@robot/scraper';
import { extractItem } from './extract-item.js';
import type { ClaimedItem } from './claim-item.js';
import type { Certification } from '../verify/current-certification.js';

// A certified Source must NEVER reach runExtraction — the whole point of
// certification is that only proven paths run. Mocked at the module boundary
// (rather than merely "never passing deps.extract") so a regression that
// falls through to the DEFAULT (`deps.extract ?? runExtraction`) inside a
// certified branch is provably caught, not just untested.
const { runExtractionMock } = vi.hoisted(() => ({ runExtractionMock: vi.fn() }));
vi.mock('@robot/scraper', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@robot/scraper')>();
  return { ...actual, runExtraction: runExtractionMock };
});

const ITEM: ClaimedItem = {
  id: 'item-1',
  url: 'https://example.com/p/1',
  inputIndex: 0,
  inputValues: { category_slug: 'shelves' },
  listingValues: { category_name: 'Shelves' },
  pageNumber: 2,
  attempts: 1,
  targetFields: null,
};

const SCHEMA = [
  { name: 'title', type: 'string', origin: 'detail' as const },
  { name: 'category_name', type: 'string', origin: 'listing' as const },
  { name: 'requested_category', type: 'string', origin: 'input' as const, input_column: 'category_slug' },
];

const fakeBrowser = {} as IBrowser;

/** Persistence is stubbed: this test is about the ROW, not about Drizzle. */
const fakeDb = {
  insert: () => ({ values: () => ({ returning: async () => [{ id: 'ext-1' }] }) }),
} as never;

describe('extractItem', () => {
  it('asks the chain only for detail-origin fields', async () => {
    let requestedFields: string[] = [];
    await extractItem(fakeDb, ITEM, {
      browser: fakeBrowser, agent: null, sourceId: 's', runId: 'r', schema: SCHEMA,
      extract: async (request) => {
        requestedFields = request.fields.map((f) => f.name);
        return { data: [{ title: 'Kallax' }], plan: null, confidence: 0.9, sources: {},
          fieldCount: { found: 1, total: 1 }, fieldsByTier: { requested: [], discovered: [] }, cacheHit: false };
      },
    });
    // A listing-origin field must never be re-fetched from the detail page: it was
    // already captured, and asking again risks a wrong value from a page that
    // does not have it.
    expect(requestedFields).toEqual(['title']);
  });

  it('carries a detail field\'s candidate ref through to the extraction request', async () => {
    const schemaWithCandidate = [
      { name: 'title', type: 'string', origin: 'detail' as const },
      {
        name: 'price', type: 'number', origin: 'detail' as const,
        candidate: { concept: 'price', label: 'list' },
      },
    ];
    let requestedFields: Array<{ name: string; candidate?: { concept: string; label: string } }> = [];
    await extractItem(fakeDb, ITEM, {
      browser: fakeBrowser, agent: null, sourceId: 's', runId: 'r', schema: schemaWithCandidate,
      extract: async (request) => {
        requestedFields = request.fields;
        return { data: [{ title: 'Kallax', price: 49 }], plan: null, confidence: 0.9, sources: {},
          fieldCount: { found: 2, total: 2 }, fieldsByTier: { requested: [], discovered: [] }, cacheHit: false };
      },
    });
    const priceField = requestedFields.find((f) => f.name === 'price');
    expect(priceField?.candidate).toEqual({ concept: 'price', label: 'list' });
  });

  it('merges the detail row with what the listing and the input already knew', async () => {
    const result = await extractItem(fakeDb, ITEM, {
      browser: fakeBrowser, agent: null, sourceId: 's', runId: 'r', schema: SCHEMA,
      extract: async () => ({ data: [{ title: 'Kallax' }], plan: null, confidence: 0.9, sources: {},
        fieldCount: { found: 1, total: 1 }, fieldsByTier: { requested: [], discovered: [] }, cacheHit: false }),
    });

    expect(result.row).toEqual({
      title: 'Kallax',
      category_name: 'Shelves',
      requested_category: 'shelves',
      _url: 'https://example.com/p/1',
      _page_number: 2,
    });
  });

  it('still produces a row when the detail page resolved nothing', async () => {
    const result = await extractItem(fakeDb, ITEM, {
      browser: fakeBrowser, agent: null, sourceId: 's', runId: 'r', schema: SCHEMA,
      extract: async () => ({ data: [], plan: null, confidence: 0, sources: {},
        fieldCount: { found: 0, total: 1 }, fieldsByTier: { requested: [], discovered: [] }, cacheHit: false }),
    });
    expect(result.row).toMatchObject({ category_name: 'Shelves', _url: 'https://example.com/p/1' });
  });

  it('lets an extraction failure propagate, so the loop can record it', async () => {
    await expect(extractItem(fakeDb, ITEM, {
      browser: fakeBrowser, agent: null, sourceId: 's', runId: 'r', schema: SCHEMA,
      extract: async () => { throw new Error('navigation timeout'); },
    })).rejects.toThrow('navigation timeout');
  });

  it('narrows the request to a repair item\'s target fields, plus the free input fields', async () => {
    const focusedSchema = [
      { name: 'title', type: 'string', origin: 'detail' as const },
      { name: 'isbn', type: 'string', origin: 'detail' as const },
      { name: 'author', type: 'string', origin: 'detail' as const },
      { name: 'requested_category', type: 'string', origin: 'input' as const, input_column: 'category_slug' },
    ];
    const seen: string[][] = [];
    const fakeExtract = async (req: { fields: Array<{ name: string }> }) => {
      seen.push(req.fields.map((f) => f.name));
      return { data: [{ isbn: '978-1' }], plan: null, confidence: 0.9, sources: {},
        fieldCount: { found: 1, total: 1 }, fieldsByTier: { requested: [], discovered: [] }, cacheHit: false };
    };

    await extractItem(fakeDb, { ...ITEM, targetFields: ['isbn'] }, {
      browser: fakeBrowser, agent: null, sourceId: 's', runId: 'r', schema: focusedSchema,
      extract: fakeExtract,
    });
    expect(seen).toEqual([['isbn']]);
  });

  it('asks for every detail field when the item carries no focus', async () => {
    const focusedSchema = [
      { name: 'title', type: 'string', origin: 'detail' as const },
      { name: 'isbn', type: 'string', origin: 'detail' as const },
      { name: 'author', type: 'string', origin: 'detail' as const },
      { name: 'requested_category', type: 'string', origin: 'input' as const, input_column: 'category_slug' },
    ];
    const seen: string[][] = [];
    const fakeExtract = async (req: { fields: Array<{ name: string }> }) => {
      seen.push(req.fields.map((f) => f.name));
      return { data: [{ title: 'Kallax', isbn: '978-1', author: 'IKEA' }], plan: null, confidence: 0.9, sources: {},
        fieldCount: { found: 3, total: 3 }, fieldsByTier: { requested: [], discovered: [] }, cacheHit: false };
    };

    await extractItem(fakeDb, { ...ITEM, targetFields: null }, {
      browser: fakeBrowser, agent: null, sourceId: 's', runId: 'r', schema: focusedSchema,
      extract: fakeExtract,
    });
    expect(seen).toEqual([['title', 'isbn', 'author']]);
  });
});

// ─── Certified extraction (Task 13) ─────────────────────────────────────────

describe('extractItem — with a certification', () => {
  const CERT_SCHEMA = [
    { name: 'price', type: 'number', origin: 'detail' as const },
    { name: 'category_name', type: 'string', origin: 'listing' as const },
    { name: 'requested_category', type: 'string', origin: 'input' as const, input_column: 'category_slug' },
  ];
  const SCHEMA_DEFINITION = [
    { key: 'price', name: 'Price', type: 'money' as const, description: 'x', concept: 'price' },
  ];
  const CERTIFICATION: Certification = {
    verificationId: 'v1',
    completedAt: new Date(),
    paths: { price: [{ source: 'api', path: 'item.priceCents', transform: 'cents_to_units' }] },
    concepts: { price: 'price_concept' },
    // M3: deliberately NOT `ITEM.url`'s host — the stats must follow the
    // certification's own hostname (the domain_intelligence row the paths
    // were saved into), not whatever host the crawled item happens to be on.
    hostname: 'shop.example.com',
  };

  it('routes through extractVerified with the field\'s certified paths, and never calls runExtraction', async () => {
    runExtractionMock.mockReset();
    let seenFields: VerifiedField[] = [];
    const extractVerified = async (req: { url: string; fields: VerifiedField[] }): Promise<VerifiedExtractionResult> => {
      seenFields = req.fields;
      return { data: { price: 129.99 }, stats: [{ key: 'price', concept: 'price_concept', path: CERTIFICATION.paths.price![0]!, hit: true, value: 129.99 }], timings: null, capture: null };
    };
    const recordStats = vi.fn(async () => {});

    const result = await extractItem(fakeDb, ITEM, {
      browser: fakeBrowser, agent: null, sourceId: 's', runId: 'r', schema: CERT_SCHEMA,
      certification: CERTIFICATION, schemaDefinition: SCHEMA_DEFINITION, extractVerified, recordStats,
    });

    expect(seenFields).toEqual([
      { key: 'price', type: 'money', concept: 'price_concept', paths: CERTIFICATION.paths.price },
    ]);
    expect(runExtractionMock).not.toHaveBeenCalled();
    expect(result.row).toMatchObject({ price: 129.99, category_name: 'Shelves', requested_category: 'shelves' });
    // M3: the certification's hostname, not `new URL(ITEM.url).hostname`.
    expect(recordStats).toHaveBeenCalledWith('shop.example.com', 'detail', [
      { concept: 'price_concept', path: CERTIFICATION.paths.price![0], hit: true, value: 129.99, url: ITEM.url },
    ]);
  });

  // I5: cache bookkeeping is an enrichment. A failing `recordVerifiedPathStats`
  // must never cost us the row it was booking stats for.
  it('persists and returns the row even when recordStats rejects', async () => {
    const extractVerified = async (): Promise<VerifiedExtractionResult> => ({
      data: { price: 129.99 },
      stats: [{ key: 'price', concept: 'price_concept', path: CERTIFICATION.paths.price![0]!, hit: true, value: 129.99 }], timings: null, capture: null,
    });
    const recordStats = vi.fn(async () => { throw new Error('deadlock detected'); });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const result = await extractItem(fakeDb, ITEM, {
        browser: fakeBrowser, agent: null, sourceId: 's', runId: 'r', schema: CERT_SCHEMA,
        certification: CERTIFICATION, schemaDefinition: SCHEMA_DEFINITION, extractVerified, recordStats,
      });

      expect(recordStats).toHaveBeenCalledTimes(1);
      expect(result.row).toMatchObject({ price: 129.99, category_name: 'Shelves' });
      expect(result.extractionId).toBe('ext-1');
      expect(logged).toHaveBeenCalledWith(
        `[crawl] verified path stats failed for ${ITEM.url}:`,
        expect.any(Error),
      );
    } finally {
      logged.mockRestore();
    }
  });

  it('defaults an untyped field to \'text\' when the key has no schemaDefinition entry', async () => {
    const cert: Certification = { verificationId: 'v2', completedAt: new Date(), paths: { price: [] }, concepts: {}, hostname: 'shop.example.com' };
    let seenFields: VerifiedField[] = [];
    const extractVerified = async (req: { url: string; fields: VerifiedField[] }): Promise<VerifiedExtractionResult> => {
      seenFields = req.fields;
      return { data: { price: null }, stats: [], timings: null, capture: null };
    };

    await extractItem(fakeDb, ITEM, {
      browser: fakeBrowser, agent: null, sourceId: 's', runId: 'r', schema: CERT_SCHEMA,
      certification: cert, schemaDefinition: [], extractVerified, recordStats: async () => {},
    });

    expect(seenFields).toEqual([{ key: 'price', type: 'text', concept: 'price', paths: [] }]);
  });

  it('records the capture timings on the capture row, so a run can be measured per product', async () => {
    const extractVerified = async (): Promise<VerifiedExtractionResult> => ({
      data: { price: 129.99 }, stats: [],
      timings: { navigateMs: 1700, readyMs: 400, readyState: 'ready', totalMs: 6900 }, capture: null,
    });
    let metadata: unknown;
    const fakeDbCapturing = {
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          if ('metadata' in v) metadata = v.metadata;
          return { returning: async () => [{ id: 'x' }] };
        },
      }),
    } as never;

    await extractItem(fakeDbCapturing, ITEM, {
      browser: fakeBrowser, agent: null, sourceId: 's', runId: 'r', schema: CERT_SCHEMA,
      certification: CERTIFICATION, schemaDefinition: SCHEMA_DEFINITION, extractVerified, recordStats: async () => {},
    });

    expect(metadata).toEqual({ capture: { navigateMs: 1700, readyMs: 400, readyState: 'ready', totalMs: 6900 } });
  });

  function captureConfidence() {
    let confidence: number | undefined;
    const fakeDbCapturing = {
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          if ('confidence' in v) confidence = v.confidence as number;
          return { returning: async () => [{ id: 'x' }] };
        },
      }),
    } as never;
    return { fakeDbCapturing, get confidence() { return confidence; } };
  }

  it('confidence is 100 when the certification produced every field', async () => {
    const extractVerified = async (): Promise<VerifiedExtractionResult> => ({ data: { price: 129.99 }, stats: [], timings: null, capture: null });
    const cap = captureConfidence();

    await extractItem(cap.fakeDbCapturing, ITEM, {
      browser: fakeBrowser, agent: null, sourceId: 's', runId: 'r', schema: CERT_SCHEMA,
      certification: CERTIFICATION, schemaDefinition: SCHEMA_DEFINITION, extractVerified, recordStats: async () => {},
    });

    expect(cap.confidence).toBe(100);
  });

  it('confidence is 0 when the certification produced no value for any field', async () => {
    const extractVerified = async (): Promise<VerifiedExtractionResult> => ({ data: { price: null }, stats: [], timings: null, capture: null });
    const cap = captureConfidence();

    await extractItem(cap.fakeDbCapturing, ITEM, {
      browser: fakeBrowser, agent: null, sourceId: 's', runId: 'r', schema: CERT_SCHEMA,
      certification: CERTIFICATION, schemaDefinition: SCHEMA_DEFINITION, extractVerified, recordStats: async () => {},
    });

    expect(cap.confidence).toBe(0);
  });

  it('falls back to the legacy runExtraction path when there is no certification', async () => {
    runExtractionMock.mockReset();
    const extractVerified = vi.fn();
    const result = await extractItem(fakeDb, ITEM, {
      browser: fakeBrowser, agent: null, sourceId: 's', runId: 'r', schema: SCHEMA,
      extract: async () => ({ data: [{ title: 'Kallax' }], plan: null, confidence: 0.9, sources: {},
        fieldCount: { found: 1, total: 1 }, fieldsByTier: { requested: [], discovered: [] }, cacheHit: false }),
      extractVerified,
      certification: null,
    });
    expect(extractVerified).not.toHaveBeenCalled();
    expect(runExtractionMock).not.toHaveBeenCalled(); // deps.extract stub was used instead of the default
    expect(result.row).toMatchObject({ title: 'Kallax' });
  });

  function captureExtraction() {
    let data: unknown;
    let rowCount: number | undefined;
    const fakeDbCapturing = {
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          if ('data' in v) { data = v.data; rowCount = v.rowCount as number; }
          return { returning: async () => [{ id: 'x' }] };
        },
      }),
    } as never;
    return { fakeDbCapturing, get data() { return data as Record<string, unknown>[]; }, get rowCount() { return rowCount; } };
  }

  // Task 3 (variants plan 3): a list-method product page becomes one row per
  // variant in the one extraction — `buildVariantRows` (verify/variant-rows.ts)
  // does the actual row-building; this is only about extractItem reading the
  // list off the SAME page capture `runVerifiedExtraction` already took and
  // persisting every row together.
  describe('extractItem — list-method variants (Task 3)', () => {
    const VARIANT_PLAN: VariantRunPlan = {
      method: 'list',
      list: { source: 'json-ld', path: 'hasVariant' },
      entryPaths: {
        sku: { kind: 'path', path: 'sku' },
        color: { kind: 'axis', from: 'color' },
      },
      fromProduct: [],
      axes: [{ key: 'color', name: 'Colour' }],
      fields: [
        { key: 'price', name: 'Price', type: 'money', level: 'product' },
        { key: 'sku', name: 'SKU', type: 'text', level: 'variant' },
      ],
      skuKey: 'sku',
    };

    function fakeCapture(ldJson: unknown[]): PageCapture {
      return {
        url: ITEM.url,
        html: '<html></html>',
        structuredData: { ldJson, nextData: null, initialState: null, meta: {} },
        interceptedRequests: [],
      } as unknown as PageCapture;
    }

    it('turns a product page carrying a 2-colour hasVariant list into one extraction with 2 rows', async () => {
      const capture = fakeCapture([{
        '@type': 'Product',
        hasVariant: [
          { sku: 'SKU-BLK', color: 'Black' },
          { sku: 'SKU-RED', color: 'Red' },
        ],
      }]);
      const extractVerified = async (): Promise<VerifiedExtractionResult> => ({
        data: { price: 129.99 }, stats: [], timings: null, capture,
      });
      const cap = captureExtraction();

      const result = await extractItem(cap.fakeDbCapturing, ITEM, {
        browser: fakeBrowser, agent: null, sourceId: 's', runId: 'r', schema: CERT_SCHEMA,
        certification: CERTIFICATION, schemaDefinition: SCHEMA_DEFINITION, extractVerified,
        recordStats: async () => {}, variantPlan: VARIANT_PLAN,
      });

      expect(cap.rowCount).toBe(2);
      expect(cap.data).toHaveLength(2);
      expect(cap.data.map((r) => r._variant_key)).toEqual(['SKU-BLK', 'SKU-RED']);
      expect(cap.data.every((r) => r._product_key)).toBe(true);
      // extractItem's return `row` stays the first row, for existing callers.
      expect(result.row).toMatchObject({ _variant_key: 'SKU-BLK' });
    });

    // Review Focus 1: the site changed and the certified list is no longer on
    // the page (resolveVariantList → null). The run never fails over it — the
    // product gets its own one-row extraction, counted "without variants".
    it('falls back to one row with a _product_key and no _variant_key when the page no longer carries the list', async () => {
      const capture = fakeCapture([{ '@type': 'Product' }]); // no hasVariant at all
      const extractVerified = async (): Promise<VerifiedExtractionResult> => ({
        data: { price: 129.99 }, stats: [], timings: null, capture,
      });
      const cap = captureExtraction();

      await extractItem(cap.fakeDbCapturing, ITEM, {
        browser: fakeBrowser, agent: null, sourceId: 's', runId: 'r', schema: CERT_SCHEMA,
        certification: CERTIFICATION, schemaDefinition: SCHEMA_DEFINITION, extractVerified,
        recordStats: async () => {}, variantPlan: VARIANT_PLAN,
      });

      expect(cap.rowCount).toBe(1);
      expect(cap.data).toHaveLength(1);
      expect(cap.data[0]!._product_key).toBeTruthy();
      expect(cap.data[0]!._variant_key).toBeUndefined();
    });

    // No plan at all: byte-for-byte today's behaviour — one row, rowCount 1,
    // same shape as the pre-Task-3 certified-extraction tests above.
    it('persists exactly one row, unchanged, when the run carries no variant plan', async () => {
      const extractVerified = async (): Promise<VerifiedExtractionResult> => ({
        data: { price: 129.99 }, stats: [], timings: null, capture: null,
      });
      const cap = captureExtraction();

      const result = await extractItem(cap.fakeDbCapturing, ITEM, {
        browser: fakeBrowser, agent: null, sourceId: 's', runId: 'r', schema: CERT_SCHEMA,
        certification: CERTIFICATION, schemaDefinition: SCHEMA_DEFINITION, extractVerified,
        recordStats: async () => {},
      });

      expect(cap.rowCount).toBe(1);
      expect(cap.data).toEqual([result.row]);
      expect(result.row).toMatchObject({ price: 129.99 });
    });
  });
});
