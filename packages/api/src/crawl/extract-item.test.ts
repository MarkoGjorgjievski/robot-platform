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
});
