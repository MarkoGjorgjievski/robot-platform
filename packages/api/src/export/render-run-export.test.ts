// The bytes of a run's file in each format — the live export (api-server) and the snapshot (run_files) share them.
import { describe, it, expect } from 'vitest';
import { renderRunExport, runJsonEnvelope, exportContentType, EXPORT_FORMATS } from './render-run-export.js';
import { toCsv, toJson } from './serialize.js';
import { exportFilename, type RunExport } from './build-run-export.js';

const FLAT: RunExport = {
  run: { id: '3f1c2b4a-1111-4111-8111-111111111111', status: 'completed', startedAt: '2026-10-24T06:00:00.000Z', completedAt: '2026-10-24T06:02:00.000Z', createdAt: '2026-10-24T05:59:00.000Z', rowCount: 1 },
  source: { slug: 'shop', name: 'Shop', url: 'https://shop.example.com/p/1' },
  fields: ['Title', 'Price'],
  rows: [{ Title: 'Lamp, white', Price: 9.99 }],
};

describe('renderRunExport', () => {
  it('CSV: the UTF-8 bytes of toCsv, BOM first', async () => {
    const r = await renderRunExport(FLAT, 'csv');
    expect(r.bytes.equals(Buffer.from(toCsv(FLAT.fields, FLAT.rows), 'utf8'))).toBe(true);
    expect([...r.bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(r).toMatchObject({ contentType: 'text/csv; charset=utf-8', filename: exportFilename(FLAT, 'csv') });
  });
  it('JSON: the four-key envelope for a flat run', async () => {
    const r = await renderRunExport(FLAT, 'json');
    expect(r.bytes.toString('utf8')).toBe(toJson({ run: FLAT.run, source: FLAT.source, fields: FLAT.fields, rows: FLAT.rows }));
    expect(r.contentType).toBe('application/json; charset=utf-8');
  });
  it('JSON: the nested shape swaps in its products and their own field lists', () => {
    const nested = { ...FLAT, json: [{ Title: 'Lamp', variants: [] }], jsonFields: ['Title', 'variants'], variantFields: ['variant_key'] } as RunExport;
    expect(JSON.parse(runJsonEnvelope(nested))).toEqual({ run: FLAT.run, source: FLAT.source, fields: ['Title', 'variants'], variantFields: ['variant_key'], rows: nested.json });
  });
  it('XLSX: a workbook (a zip)', async () => {
    const r = await renderRunExport(FLAT, 'xlsx');
    expect(r.bytes.subarray(0, 2).toString('latin1')).toBe('PK');
    expect(r.contentType).toBe(exportContentType('xlsx'));
    expect(EXPORT_FORMATS).toEqual(['csv', 'json', 'xlsx']);
  });
});
