import { describe, it, expect } from 'vitest';
import { DETAIL_URL_FIELD } from '@robot/scraper';
import { deriveColumns, buildRunExport, exportFilename, shapeRows } from './build-run-export.js';

const RUN = {
  id: '3f1c2b4a-0000-0000-0000-000000000000',
  status: 'completed',
  startedAt: new Date('2026-08-19T10:00:00Z'),
  completedAt: new Date('2026-08-19T10:02:00Z'),
  createdAt: new Date('2026-08-19T09:59:00Z'),
  resultCount: 1,
};

const SOURCE = {
  slug: 'newegg-gpu',
  name: 'Newegg GPUs',
  urlTemplate: 'https://newegg.com/p/123',
  selectorsJson: { fields: [{ name: 'title', type: 'string' }, { name: 'price', type: 'price' }] },
};

describe('deriveColumns', () => {
  it('takes column order from the schema, not from the data', () => {
    const columns = deriveColumns(
      [{ name: 'title' }, { name: 'price' }],
      [{ price: 79, title: 'Kallax' }],
    );
    expect(columns).toEqual(['title', 'price']);
  });

  it('keeps a schema field that no row resolved, so the column set is stable across runs', () => {
    const columns = deriveColumns([{ name: 'title' }, { name: 'rating' }], [{ title: 'Kallax' }]);
    expect(columns).toEqual(['title', 'rating']);
  });

  it('drops fields explicitly disabled in the schema', () => {
    const columns = deriveColumns(
      [{ name: 'title' }, { name: 'internal_id', enabled: false }],
      [{ title: 'Kallax' }],
    );
    expect(columns).toEqual(['title']);
  });

  it('appends data keys missing from the schema rather than dropping them', () => {
    const columns = deriveColumns([{ name: 'title' }], [{ title: 'Kallax', sku: 'A1' }]);
    expect(columns).toEqual(['title', 'sku']);
  });

  it('never repeats a column when several rows carry the same extra key', () => {
    const columns = deriveColumns([], [{ sku: 'A1' }, { sku: 'A2' }]);
    expect(columns).toEqual(['sku']);
  });

  it('falls back to the union of data keys when the schema is empty', () => {
    const columns = deriveColumns([], [{ title: 'Kallax' }, { price: 79 }]);
    expect(columns).toEqual(['title', 'price']);
  });

  it('returns no columns when there is neither schema nor data', () => {
    expect(deriveColumns([], [])).toEqual([]);
  });
});

describe('buildRunExport', () => {
  it('builds an envelope carrying run provenance, fields and rows', () => {
    const result = buildRunExport({
      run: RUN,
      source: SOURCE,
      captureUrl: 'https://newegg.com/p/123?x=1',
      extractionData: [{ title: 'Kallax', price: 79 }],
    });
    expect(result).toEqual({
      run: {
        id: RUN.id,
        status: 'completed',
        startedAt: '2026-08-19T10:00:00.000Z',
        completedAt: '2026-08-19T10:02:00.000Z',
        createdAt: '2026-08-19T09:59:00.000Z',
        rowCount: 1,
      },
      source: { slug: 'newegg-gpu', name: 'Newegg GPUs', url: 'https://newegg.com/p/123?x=1' },
      fields: ['title', 'price'],
      rows: [{ title: 'Kallax', price: 79 }],
    });
  });

  it('reports the row count of the exported rows, not the stored counter', () => {
    const result = buildRunExport({
      run: { ...RUN, resultCount: 99 },
      source: SOURCE,
      captureUrl: null,
      extractionData: [{ title: 'Kallax' }, { title: 'Billy' }],
    });
    expect(result.run.rowCount).toBe(2);
  });

  it('falls back to the source url template when the run captured no url', () => {
    const result = buildRunExport({ run: RUN, source: SOURCE, captureUrl: null, extractionData: [] });
    expect(result.source?.url).toBe('https://newegg.com/p/123');
  });

  it('exports the schema columns with zero rows when the run produced no extraction', () => {
    const result = buildRunExport({ run: RUN, source: SOURCE, captureUrl: null, extractionData: null });
    expect(result.rows).toEqual([]);
    expect(result.fields).toEqual(['title', 'price']);
  });

  it('treats non-array extraction data as no rows', () => {
    const result = buildRunExport({ run: RUN, source: SOURCE, captureUrl: null, extractionData: { title: 'x' } });
    expect(result.rows).toEqual([]);
  });

  it('handles a run whose source has been detached', () => {
    const result = buildRunExport({ run: RUN, source: null, captureUrl: null, extractionData: [{ title: 'Kallax' }] });
    expect(result.source).toBeNull();
    expect(result.fields).toEqual(['title']);
  });

  // DETAIL_URL_FIELD is planning machinery, not exported data: it is the
  // row-scoped "which detail page" field `runListingAnalysis` always adds,
  // and that the deleted `sources.analyze` procedure (removed 2026-09; no
  // live writer) used to persist into `selectorsJson.fields` verbatim. It
  // never reaches the per-item extraction data (effectiveSchema already
  // filters it out at extraction time — packages/api/src/crawl/effective-
  // schema.ts). Left in here, the schema-driven half of `deriveColumns`
  // still adds it, and since no row ever carries the key, it renders as a
  // permanently empty phantom column.
  it('filters the synthetic detail_url field out of export columns, keeping genuine fields', () => {
    const result = buildRunExport({
      run: RUN,
      source: {
        ...SOURCE,
        selectorsJson: {
          fields: [
            { name: DETAIL_URL_FIELD, type: 'url' },
            { name: 'listing_id', type: 'string' },
            { name: 'title', type: 'string' },
          ],
        },
      },
      captureUrl: null,
      extractionData: [{ title: 'Kallax', listing_id: '123' }],
    });
    expect(result.fields).toEqual(['listing_id', 'title']);
  });

  it('exports rows keyed by field key under the customer-declared display name header', () => {
    const result = buildRunExport({
      run: RUN,
      source: {
        ...SOURCE,
        schemaDefinition: [
          { key: 'price', name: 'Price', type: 'money', description: '', concept: 'price' },
          { key: 'title', name: 'Title', type: 'text', description: '', concept: 'product_name' },
        ],
      },
      captureUrl: null,
      extractionData: [{ price: 79, title: 'Kallax' }],
    });
    expect(result.fields).toEqual(['Price', 'Title']);
    expect(result.rows).toEqual([{ Price: 79, Title: 'Kallax' }]);
  });

  it('keeps `_`-prefixed keys and drops undeclared keys for a customer schema', () => {
    const result = buildRunExport({
      run: RUN,
      source: {
        ...SOURCE,
        schemaDefinition: [{ key: 'price', name: 'Price', type: 'money', description: '', concept: 'price' }],
      },
      captureUrl: null,
      extractionData: [{ price: 79, _url: 'https://example.com/1', undeclared: 'drop me' }],
    });
    expect(result.rows).toEqual([{ Price: 79, _url: 'https://example.com/1' }]);
  });

  it('fills a missing customer field with null rather than omitting the key', () => {
    const result = buildRunExport({
      run: RUN,
      source: {
        ...SOURCE,
        schemaDefinition: [
          { key: 'price', name: 'Price', type: 'money', description: '', concept: 'price' },
          { key: 'title', name: 'Title', type: 'text', description: '', concept: 'product_name' },
        ],
      },
      captureUrl: null,
      extractionData: [{ price: 79 }],
    });
    expect(result.rows).toEqual([{ Price: 79, Title: null }]);
  });

  it('ignores an empty schemaDefinition and falls back to legacy selectorsJson behaviour', () => {
    const result = buildRunExport({
      run: RUN,
      source: { ...SOURCE, schemaDefinition: [] },
      captureUrl: null,
      extractionData: [{ title: 'Kallax', price: 79 }],
    });
    expect(result.fields).toEqual(['title', 'price']);
    expect(result.rows).toEqual([{ title: 'Kallax', price: 79 }]);
  });

  it('tolerates a source whose selectorsJson holds no field list', () => {
    const result = buildRunExport({
      run: RUN,
      source: { ...SOURCE, selectorsJson: null },
      captureUrl: null,
      extractionData: [{ title: 'Kallax' }],
    });
    expect(result.fields).toEqual(['title']);
  });
});

describe('exportFilename', () => {
  it('names the file after the source, the run and the completion date', () => {
    const envelope = buildRunExport({ run: RUN, source: SOURCE, captureUrl: null, extractionData: [] });
    expect(exportFilename(envelope, 'csv')).toBe('newegg-gpu-3f1c2b4a-2026-08-19.csv');
  });

  it('uses the json extension for json exports', () => {
    const envelope = buildRunExport({ run: RUN, source: SOURCE, captureUrl: null, extractionData: [] });
    expect(exportFilename(envelope, 'json')).toBe('newegg-gpu-3f1c2b4a-2026-08-19.json');
  });

  it('falls back to the creation date when the run never completed', () => {
    const envelope = buildRunExport({
      run: { ...RUN, startedAt: null, completedAt: null },
      source: SOURCE,
      captureUrl: null,
      extractionData: [],
    });
    expect(exportFilename(envelope, 'csv')).toBe('newegg-gpu-3f1c2b4a-2026-08-19.csv');
  });

  it('falls back to a generic name when the run has no source', () => {
    const envelope = buildRunExport({ run: RUN, source: null, captureUrl: null, extractionData: [] });
    expect(exportFilename(envelope, 'csv')).toBe('run-3f1c2b4a-2026-08-19.csv');
  });

  it('strips characters that do not belong in a filename', () => {
    const envelope = buildRunExport({
      run: RUN,
      source: { ...SOURCE, slug: 'New Egg/GPUs "2026"' },
      captureUrl: null,
      extractionData: [],
    });
    expect(exportFilename(envelope, 'csv')).toBe('new-egg-gpus-2026-3f1c2b4a-2026-08-19.csv');
  });

  it('names an xlsx download the same way', () => {
    const envelope = buildRunExport({ run: RUN, source: SOURCE, captureUrl: null, extractionData: [] });
    expect(exportFilename(envelope, 'xlsx')).toBe('newegg-gpu-3f1c2b4a-2026-08-19.xlsx');
  });
});

const PRODUCT_FIELD = { key: 'title', name: 'Title', level: 'product' as const };
const BRAND_FIELD = { key: 'brand', name: 'Brand', level: 'product' as const };
const PRICE_FIELD = { key: 'price', name: 'Price', level: 'variant' as const };
const SKU_FIELD = { key: 'sku', name: 'SKU', level: 'variant' as const };
const COLOUR_AXIS = { key: 'color', name: 'Colour' };

describe('shapeRows', () => {
  it('leaves a flat run unchanged, just renaming field keys to their names', () => {
    const result = shapeRows({
      rows: [{ title: 'Chair', brand: 'Acme' }],
      shape: 'flat',
      fields: [PRODUCT_FIELD, BRAND_FIELD],
      axes: [],
    });
    expect(result.columns).toEqual(['Title', 'Brand']);
    expect(result.rows).toEqual([{ Title: 'Chair', Brand: 'Acme' }]);
    expect(result.json).toEqual(result.rows);
  });

  it('row_per_variant orders columns product fields, axes, variant fields, product_key, variant_key', () => {
    const result = shapeRows({
      rows: [
        { title: 'Chair', brand: 'Acme', color: 'Red', price: 10, sku: 'A1', _product_key: 'p1', _variant_key: 'A1' },
        { title: 'Chair', brand: 'Acme', color: 'Blue', price: 12, sku: 'A2', _product_key: 'p1', _variant_key: 'A2' },
      ],
      shape: 'row_per_variant',
      fields: [PRODUCT_FIELD, BRAND_FIELD, PRICE_FIELD, SKU_FIELD],
      axes: [COLOUR_AXIS],
    });
    expect(result.columns).toEqual(['Title', 'Brand', 'Colour', 'Price', 'SKU', 'product_key', 'variant_key']);
    expect(result.rows).toEqual([
      { Title: 'Chair', Brand: 'Acme', Colour: 'Red', Price: 10, SKU: 'A1', product_key: 'p1', variant_key: 'A1' },
      { Title: 'Chair', Brand: 'Acme', Colour: 'Blue', Price: 12, SKU: 'A2', product_key: 'p1', variant_key: 'A2' },
    ]);
    expect(result.json).toEqual(result.rows);
  });

  it('row_per_variant fills a product-without-variants row with null axis/variant cells and no variant_key', () => {
    const result = shapeRows({
      rows: [{ title: 'Table', brand: 'Acme', _product_key: 'p2' }],
      shape: 'row_per_variant',
      fields: [PRODUCT_FIELD, BRAND_FIELD, PRICE_FIELD, SKU_FIELD],
      axes: [COLOUR_AXIS],
    });
    expect(result.rows).toEqual([
      { Title: 'Table', Brand: 'Acme', Colour: null, Price: null, SKU: null, product_key: 'p2', variant_key: null },
    ]);
  });

  it('never exports _variant_partial', () => {
    const result = shapeRows({
      rows: [{ title: 'Chair', price: null, _product_key: 'p1', _variant_key: 'A1', _variant_partial: true }],
      shape: 'row_per_variant',
      fields: [PRODUCT_FIELD, PRICE_FIELD],
      axes: [],
    });
    expect(result.rows[0]).not.toHaveProperty('_variant_partial');
  });

  // Review Focus 5: a product with no variants gets `variants: []` in nested
  // JSON, never dropped — and a "; "-joined but present row in CSV/XLSX.
  describe('nested', () => {
    const rows = [
      { title: 'Chair', brand: 'Acme', color: 'Red', price: 10, sku: 'A1', _product_key: 'p1', _variant_key: 'A1' },
      { title: 'Chair', brand: 'Acme', color: 'Blue', price: 12, sku: 'A2', _product_key: 'p1', _variant_key: 'A2' },
      { title: 'Table', brand: 'Acme', price: 15, sku: 'T1', _product_key: 'p2' },
    ];
    const fields = [PRODUCT_FIELD, BRAND_FIELD, PRICE_FIELD, SKU_FIELD];
    const axes = [COLOUR_AXIS];

    // Final review I4 (ruling a): a product without variants keeps
    // `variants: []` and carries its variant-level values (Price, SKU) on the
    // product object itself — never dropped from the JSON.
    it('gives one JSON object per product, with an empty variants array for a product with none', () => {
      const result = shapeRows({ rows, shape: 'nested', fields, axes });
      expect(result.json).toEqual([
        {
          Title: 'Chair',
          Brand: 'Acme',
          product_key: 'p1',
          variants: [
            { variant_key: 'A1', Colour: 'Red', Price: 10, SKU: 'A1' },
            { variant_key: 'A2', Colour: 'Blue', Price: 12, SKU: 'A2' },
          ],
        },
        { Title: 'Table', Brand: 'Acme', Price: 15, SKU: 'T1', product_key: 'p2', variants: [] },
      ]);
    });

    it('gives one CSV/XLSX row per product, joining each variant column with "; "', () => {
      const result = shapeRows({ rows, shape: 'nested', fields, axes });
      expect(result.columns).toEqual(['Title', 'Brand', 'Colour', 'Price', 'SKU', 'product_key']);
      expect(result.rows).toEqual([
        { Title: 'Chair', Brand: 'Acme', Colour: 'Red; Blue', Price: '10; 12', SKU: 'A1; A2', product_key: 'p1' },
        { Title: 'Table', Brand: 'Acme', Colour: '', Price: '15', SKU: 'T1', product_key: 'p2' },
      ]);
    });
  });

  // Fix round 1, ruling: a column-name collision never loses data — the
  // later column gets a numbered suffix, and a synthetic product_key/
  // variant_key column yields to a customer field of the same name.
  describe('column-name collisions', () => {
    it('keeps both values under distinct headers when an axis is named like a field', () => {
      const priceField = { key: 'price', name: 'Price', level: 'product' as const };
      const priceAxis = { key: 'price_axis', name: 'Price' };
      const result = shapeRows({
        rows: [{ price: 10, price_axis: 'Large', _product_key: 'p1', _variant_key: 'v1' }],
        shape: 'row_per_variant',
        fields: [priceField],
        axes: [priceAxis],
      });
      expect(result.columns).toEqual(['Price', 'Price (2)', 'product_key', 'variant_key']);
      expect(result.rows).toEqual([{ Price: 10, 'Price (2)': 'Large', product_key: 'p1', variant_key: 'v1' }]);
    });

    it('keeps a field named variant_key and renames the synthetic column to "variant_key (2)" (row_per_variant)', () => {
      const variantKeyField = { key: 'vk', name: 'variant_key', level: 'variant' as const };
      const result = shapeRows({
        rows: [{ vk: 'customer-value', _product_key: 'p1', _variant_key: 'synthetic-value' }],
        shape: 'row_per_variant',
        fields: [variantKeyField],
        axes: [],
      });
      expect(result.columns).toEqual(['variant_key', 'product_key', 'variant_key (2)']);
      expect(result.rows).toEqual([{ variant_key: 'customer-value', product_key: 'p1', 'variant_key (2)': 'synthetic-value' }]);
    });

    it('keeps a field named product_key and renames the synthetic column, in nested CSV and JSON alike', () => {
      const productKeyField = { key: 'pk', name: 'product_key', level: 'product' as const };
      const result = shapeRows({
        rows: [{ pk: 'customer-value', _product_key: 'synthetic-value', _variant_key: 'v1' }],
        shape: 'nested',
        fields: [productKeyField],
        axes: [],
      });
      expect(result.columns).toEqual(['product_key', 'product_key (2)']);
      expect(result.rows).toEqual([{ product_key: 'customer-value', 'product_key (2)': 'synthetic-value' }]);
      expect(result.json).toEqual([{ product_key: 'customer-value', 'product_key (2)': 'synthetic-value', variants: [{ variant_key: 'v1' }] }]);
    });

    it('keeps a variant-level field named variant_key inside the nested JSON variants array, renaming the synthetic one', () => {
      const variantKeyField = { key: 'vk', name: 'variant_key', level: 'variant' as const };
      const result = shapeRows({
        rows: [{ vk: 'customer-value', _product_key: 'p1', _variant_key: 'synthetic-value' }],
        shape: 'nested',
        fields: [variantKeyField],
        axes: [],
      });
      expect(result.json).toEqual([
        { product_key: 'p1', variants: [{ variant_key: 'customer-value', 'variant_key (2)': 'synthetic-value' }] },
      ]);
    });

    it('resolves three-way collisions with ascending suffixes', () => {
      const a = { key: 'a', name: 'Dup', level: 'product' as const };
      const b = { key: 'b', name: 'Dup', level: 'product' as const };
      const c = { key: 'c', name: 'Dup', level: 'product' as const };
      const result = shapeRows({
        rows: [{ a: 1, b: 2, c: 3 }],
        shape: 'flat',
        fields: [a, b, c],
        axes: [],
      });
      expect(result.columns).toEqual(['Dup', 'Dup (2)', 'Dup (3)']);
      expect(result.rows).toEqual([{ Dup: 1, 'Dup (2)': 2, 'Dup (3)': 3 }]);
    });
  });
});

describe('buildRunExport with variants', () => {
  const DATASET_SCHEMA = [
    { key: 'title', name: 'Title', type: 'text', concept: 'product_name' },
    { key: 'price', name: 'Price', type: 'money', concept: 'price' },
    { key: 'sku', name: 'SKU', type: 'text', concept: 'sku' },
    { key: 'color', name: 'Colour', kind: 'axis', concept: 'axis' },
  ];
  const VARIANT_ROWS = [
    { title: 'Chair', color: 'Red', price: 10, sku: 'A1', _product_key: 'p1', _variant_key: 'A1' },
    { title: 'Chair', color: 'Blue', price: 12, sku: 'A2', _product_key: 'p1', _variant_key: 'A2' },
  ];

  it('exports row_per_variant in contract order with product_key/variant_key columns', () => {
    const result = buildRunExport({
      run: RUN,
      source: SOURCE,
      captureUrl: null,
      extractionData: VARIANT_ROWS,
      dataset: { schema: DATASET_SCHEMA, variantMode: 'row_per_variant' },
    });
    expect(result.fields).toEqual(['Title', 'Colour', 'Price', 'SKU', 'product_key', 'variant_key']);
    expect(result.rows).toEqual([
      { Title: 'Chair', Colour: 'Red', Price: 10, SKU: 'A1', product_key: 'p1', variant_key: 'A1' },
      { Title: 'Chair', Colour: 'Blue', Price: 12, SKU: 'A2', product_key: 'p1', variant_key: 'A2' },
    ]);
    expect(result.json).toBeUndefined();
    expect(result.types).toEqual({ Title: 'text', Price: 'money', SKU: 'text' });
  });

  it('exports nested with a json field distinct from the CSV/XLSX rows', () => {
    const result = buildRunExport({
      run: RUN,
      source: SOURCE,
      captureUrl: null,
      extractionData: VARIANT_ROWS,
      dataset: { schema: DATASET_SCHEMA, variantMode: 'nested' },
    });
    expect(result.fields).toEqual(['Title', 'Colour', 'Price', 'SKU', 'product_key']);
    expect(result.rows).toEqual([{ Title: 'Chair', Colour: 'Red; Blue', Price: '10; 12', SKU: 'A1; A2', product_key: 'p1' }]);
    expect(result.json).toEqual([
      {
        Title: 'Chair',
        product_key: 'p1',
        variants: [
          { variant_key: 'A1', Colour: 'Red', Price: 10, SKU: 'A1' },
          { variant_key: 'A2', Colour: 'Blue', Price: 12, SKU: 'A2' },
        ],
      },
    ]);
  });

  it('stays flat when the run produced no _product_key rows, even on a row_per_variant project', () => {
    const result = buildRunExport({
      run: RUN,
      source: SOURCE,
      captureUrl: null,
      extractionData: [{ title: 'Kallax', price: 79 }],
      dataset: { schema: DATASET_SCHEMA, variantMode: 'row_per_variant' },
    });
    expect(result.fields).toEqual(['title', 'price']);
    expect(result.rows).toEqual([{ title: 'Kallax', price: 79 }]);
    expect(result.json).toBeUndefined();
  });

  // Final review M8: the type map is keyed by the FINAL column name — a field
  // renamed by uniqueNames ("Price (2)") keeps its number typing, and the
  // column that took the plain name does not inherit it.
  it('keys the xlsx type map by the final column name after a collision rename', () => {
    const result = buildRunExport({
      run: RUN,
      source: SOURCE,
      captureUrl: null,
      extractionData: [{ title: 'Chair', size: 'Large', price: 10, sku: 'A1', _product_key: 'p1', _variant_key: 'A1' }],
      dataset: {
        schema: [
          { key: 'title', name: 'Title', type: 'text', concept: 'product_name' },
          { key: 'price', name: 'Price', type: 'money', concept: 'price' },
          { key: 'sku', name: 'SKU', type: 'text', concept: 'sku' },
          { key: 'size', name: 'Price', kind: 'axis', concept: 'axis' },
        ],
        variantMode: 'row_per_variant',
      },
    });
    expect(result.fields).toEqual(['Title', 'Price', 'Price (2)', 'SKU', 'product_key', 'variant_key']);
    expect(result.rows[0]).toMatchObject({ Price: 'Large', 'Price (2)': 10 });
    expect(result.types).toEqual({ Title: 'text', 'Price (2)': 'money', SKU: 'text' });
  });
});
