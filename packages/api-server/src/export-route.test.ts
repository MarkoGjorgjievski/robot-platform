import { describe, it, expect } from 'vitest';
import { createApp } from './app.js';
import type { RunExport } from '@robot/api/export';
import type { SessionInfo } from '@robot/api/auth';

const RUN_ID = '3f1c2b4a-1111-4111-8111-111111111111';

const SESSION: SessionInfo = {
  token: 't',
  user: { id: 'u1', email: 'owner@example.com', name: 'Owner', avatarColour: '#000', theme: 'light' },
  org: { id: 'org-1', slug: 'owner-org', name: 'Owner Org', personal: true },
  role: 'owner',
};
const COOKIE = { cookie: 'robot_session=valid-token' };

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

/** The app with its DB loader replaced, so route behaviour is testable offline.
 *  Defaults to a signed-in request for the run's own org — the shape every
 *  pre-existing test in this file exercises — unless overridden. */
function appWith(envelope: RunExport | null, opts: { session?: SessionInfo | null; orgId?: string | null } = {}) {
  const session = opts.session === undefined ? SESSION : opts.session;
  const orgId = opts.orgId === undefined ? SESSION.org.id : opts.orgId;
  return createApp({
    loadRunExport: async () => envelope,
    loadSession: async () => session,
    orgIdForRun: async () => orgId,
  });
}

function get(app: ReturnType<typeof createApp>, path: string, headers: Record<string, string> = COOKIE) {
  return app.fetch(new Request(`http://localhost${path}`, { headers }));
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
    jsonFields: ['Title', 'product_key', 'variants'],
    variantFields: ['variant_key', 'Price'],
  };

  it('serves the json-specific per-product rows, not the flattened CSV/XLSX ones', async () => {
    const res = await appWith(NESTED_ENVELOPE).fetch(new Request(`http://localhost/export/runs/${RUN_ID}.json`));
    const body = await res.json();
    expect(body.rows).toEqual(NESTED_ENVELOPE.json);
  });

  // D3 (live check, 2026-10-05): `fields` on the nested JSON response
  // describes the product object (`jsonFields`), not the CSV shape, and a
  // new `variantFields` describes the inner `variants[]` object.
  it('describes the nested JSON shape with jsonFields/variantFields, not the CSV columns', async () => {
    const res = await appWith(NESTED_ENVELOPE).fetch(new Request(`http://localhost/export/runs/${RUN_ID}.json`));
    const body = await res.json();
    expect(body.fields).toEqual(['Title', 'product_key', 'variants']);
    expect(body.variantFields).toEqual(['variant_key', 'Price']);
  });

  it('serves the flattened rows for csv', async () => {
    const res = await appWith(NESTED_ENVELOPE).fetch(new Request(`http://localhost/export/runs/${RUN_ID}.csv`));
    expect(await res.text()).toBe('Title,product_key\r\nChair,p1\r\n');
  });

  // D2 (live check, 2026-10-05): the nested shape is lossy in CSV/XLSX
  // (joined cells, no variant_key) — the file name says so.
  it('names the json download "-variants-nested"', async () => {
    const res = await appWith(NESTED_ENVELOPE).fetch(new Request(`http://localhost/export/runs/${RUN_ID}.json`));
    expect(res.headers.get('content-disposition')).toBe(
      'attachment; filename="newegg-gpu-3f1c2b4a-2026-08-19-variants-nested.json"',
    );
  });

  it('names the csv and xlsx downloads "-variants-joined"', async () => {
    const csv = await appWith(NESTED_ENVELOPE).fetch(new Request(`http://localhost/export/runs/${RUN_ID}.csv`));
    expect(csv.headers.get('content-disposition')).toBe(
      'attachment; filename="newegg-gpu-3f1c2b4a-2026-08-19-variants-joined.csv"',
    );
    const xlsx = await appWith(NESTED_ENVELOPE).fetch(new Request(`http://localhost/export/runs/${RUN_ID}.xlsx`));
    expect(xlsx.headers.get('content-disposition')).toBe(
      'attachment; filename="newegg-gpu-3f1c2b4a-2026-08-19-variants-joined.xlsx"',
    );
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

// Final review I1: the run route is gated the same way the tRPC context is —
// signed out is 401, a run belonging to another org is 404 indistinguishably
// from one that doesn't exist, and the owning org's session gets a 200 in
// every format.
describe('GET /export/runs/:file session gating', () => {
  for (const format of ['csv', 'json', 'xlsx'] as const) {
    it(`responds 401 for ${format} with no session`, async () => {
      const app = appWith(ENVELOPE, { session: null });
      const res = await get(app, `/export/runs/${RUN_ID}.${format}`, {});
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'Sign in first' });
    });

    it(`responds 404 for ${format} when the run belongs to another org`, async () => {
      const app = appWith(ENVELOPE, { orgId: 'some-other-org' });
      const res = await get(app, `/export/runs/${RUN_ID}.${format}`);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'Run not found' });
    });

    it(`responds 200 for ${format} when the session's org owns the run`, async () => {
      const app = appWith(ENVELOPE);
      const res = await get(app, `/export/runs/${RUN_ID}.${format}`);
      expect(res.status).toBe(200);
    });
  }
});
