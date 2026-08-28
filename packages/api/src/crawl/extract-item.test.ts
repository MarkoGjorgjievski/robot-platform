// packages/api/src/crawl/extract-item.test.ts
import { describe, it, expect } from 'vitest';
import type { IBrowser } from '@robot/browser';
import { extractItem } from './extract-item.js';
import type { ClaimedItem } from './claim-item.js';

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
