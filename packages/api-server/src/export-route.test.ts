import { describe, it, expect } from 'vitest';
import { createApp } from './app.js';
import type { RunExport } from '@robot/api/export';

const RUN_ID = '3f1c2b4a-1111-4111-8111-111111111111';

const ENVELOPE: RunExport = {
  run: {
    id: RUN_ID,
    status: 'completed',
    startedAt: '2026-08-19T10:00:00.000Z',
    completedAt: '2026-08-19T10:02:00.000Z',
    createdAt: '2026-08-19T09:59:00.000Z',
    rowCount: 1,
  },
  source: { slug: 'newegg-gpu', name: 'Newegg GPUs', url: 'https://newegg.com/p/123' },
  fields: ['title', 'price'],
  rows: [{ title: 'Kallax, white', price: 79 }],
};

/** The app with its DB loader replaced, so route behaviour is testable offline. */
function appWith(envelope: RunExport | null) {
  return createApp({ loadRunExport: async () => envelope });
}

describe('GET /export/runs/:id.csv', () => {
  it('serves the run rows as CSV', async () => {
    const res = await appWith(ENVELOPE).fetch(new Request(`http://localhost/export/runs/${RUN_ID}.csv`));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('title,price\r\n"Kallax, white",79\r\n');
  });

  it('sends a UTF-8 BOM so Excel reads non-ASCII values correctly', async () => {
    const res = await appWith(ENVELOPE).fetch(new Request(`http://localhost/export/runs/${RUN_ID}.csv`));
    // Response.text() strips a leading BOM per spec, so assert on the raw bytes.
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('declares UTF-8 CSV so browsers do not sniff the encoding', async () => {
    const res = await appWith(ENVELOPE).fetch(new Request(`http://localhost/export/runs/${RUN_ID}.csv`));
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
  });

  it('offers the file as a download named after the source and run', async () => {
    const res = await appWith(ENVELOPE).fetch(new Request(`http://localhost/export/runs/${RUN_ID}.csv`));
    expect(res.headers.get('content-disposition')).toBe(
      'attachment; filename="newegg-gpu-3f1c2b4a-2026-08-19.csv"',
    );
  });
});

describe('GET /export/runs/:id.json', () => {
  it('serves the whole envelope as JSON', async () => {
    const res = await appWith(ENVELOPE).fetch(new Request(`http://localhost/export/runs/${RUN_ID}.json`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(ENVELOPE);
  });

  it('declares JSON and a .json download name', async () => {
    const res = await appWith(ENVELOPE).fetch(new Request(`http://localhost/export/runs/${RUN_ID}.json`));
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('content-disposition')).toBe(
      'attachment; filename="newegg-gpu-3f1c2b4a-2026-08-19.json"',
    );
  });
});

describe('GET /export/runs/:id.xlsx', () => {
  it('serves the run rows as an xlsx workbook', async () => {
    const res = await appWith(ENVELOPE).fetch(new Request(`http://localhost/export/runs/${RUN_ID}.xlsx`));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(res.headers.get('content-disposition')).toBe(
      'attachment; filename="newegg-gpu-3f1c2b4a-2026-08-19.xlsx"',
    );
    // An xlsx file is a zip archive — its first two bytes are the "PK" signature.
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x50, 0x4b]);
  });
});

describe('GET /export/runs/:id.json for a nested-shape run', () => {
  const NESTED_ENVELOPE: RunExport = {
    ...ENVELOPE,
    fields: ['Title', 'product_key'],
    rows: [{ Title: 'Chair', product_key: 'p1' }],
    json: [{ Title: 'Chair', product_key: 'p1', variants: [{ variant_key: 'v1', Price: 10 }] }],
  };

  it('serves the json-specific per-product rows, not the flattened CSV/XLSX ones', async () => {
    const res = await appWith(NESTED_ENVELOPE).fetch(new Request(`http://localhost/export/runs/${RUN_ID}.json`));
    const body = await res.json();
    expect(body.rows).toEqual(NESTED_ENVELOPE.json);
  });

  it('serves the flattened rows for csv', async () => {
    const res = await appWith(NESTED_ENVELOPE).fetch(new Request(`http://localhost/export/runs/${RUN_ID}.csv`));
    expect(await res.text()).toBe('Title,product_key\r\nChair,p1\r\n');
  });
});

describe('export route errors', () => {
  it('responds 404 when the run does not exist', async () => {
    const res = await appWith(null).fetch(new Request(`http://localhost/export/runs/${RUN_ID}.csv`));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Run not found' });
  });

  it('responds 404 for a malformed run id without querying the database', async () => {
    let queried = false;
    const app = createApp({
      loadRunExport: async () => {
        queried = true;
        return ENVELOPE;
      },
    });
    const res = await app.fetch(new Request('http://localhost/export/runs/not-a-uuid.csv'));
    expect(res.status).toBe(404);
    expect(queried).toBe(false);
  });

  it('responds 404 for an unsupported format', async () => {
    const res = await appWith(ENVELOPE).fetch(new Request(`http://localhost/export/runs/${RUN_ID}.pdf`));
    expect(res.status).toBe(404);
  });

  it('exports a run that produced no rows as a header-only CSV', async () => {
    const empty = { ...ENVELOPE, run: { ...ENVELOPE.run, rowCount: 0 }, rows: [] };
    const res = await appWith(empty).fetch(new Request(`http://localhost/export/runs/${RUN_ID}.csv`));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('title,price\r\n');
  });
});
