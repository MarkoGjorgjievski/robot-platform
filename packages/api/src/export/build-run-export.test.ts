import { describe, it, expect } from 'vitest';
import { DETAIL_URL_FIELD } from '@robot/scraper';
import { deriveColumns, buildRunExport, exportFilename } from './build-run-export.js';

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
  // row-scoped "which detail page" field `runListingAnalysis` always adds
  // and `sources.analyze` persists into `selectorsJson.fields` verbatim, and
  // it never reaches the per-item extraction data (effectiveSchema already
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
});
