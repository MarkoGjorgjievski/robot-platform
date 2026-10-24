// Spec 2026-10-24 §3.3: a run's snapshot by session (?snapshot=1) or by signed link (no session). Offline: every
// collaborator is injected; the live export must never be built for a snapshot.
import { createHmac } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import type { SessionInfo } from '@robot/api/auth';
import { createApp } from './app.js';

const RUN = '3f1c2b4a-1111-4111-8111-111111111111';
const OTHER = '9a8b7c6d-2222-4222-8222-222222222222';
const SECRET = 'ab'.repeat(32);
const NOW_S = Math.floor(Date.now() / 1000);
const SESSION: SessionInfo = {
  token: 't',
  user: { id: 'u1', email: 'owner@example.com', name: 'Owner', avatarColour: '#000', theme: 'light' },
  org: { id: 'org-1', slug: 'owner-org', name: 'Owner Org', personal: true },
  role: 'owner',
};
const SNAP: Record<string, Buffer> = {
  [`${RUN}.csv`]: Buffer.from('﻿Price\r\n9.99\r\n', 'utf8'),
  [`${RUN}.json`]: Buffer.from('{"rows":[{"Price":9.99}]}', 'utf8'),
  [`${RUN}.xlsx`]: Buffer.from('PK\u0003\u0004snapshot', 'latin1'),
};
const sign = (secret: string, runId: string, format: string, expires: number) => createHmac('sha256', secret).update(`${runId}.${format}.${expires}`).digest('hex');
const link = (format: string, o: { runId?: string; secret?: string; expires?: number; signedFormat?: string } = {}) => {
  const expires = o.expires ?? NOW_S + 3600;
  return `/export/runs/${RUN}.${format}?expires=${expires}&sig=${sign(o.secret ?? SECRET, o.runId ?? RUN, o.signedFormat ?? format, expires)}`;
};

function app(o: { secret?: string | null; session?: SessionInfo | null; orgId?: string | null; files?: Record<string, Buffer> } = {}) {
  const files = o.files ?? SNAP;
  return createApp({
    loadSession: async () => (o.session === undefined ? SESSION : o.session),
    orgIdForRun: async () => (o.orgId === undefined ? SESSION.org.id : o.orgId),
    loadRunExport: async () => { throw new Error('the live export must not be built for a snapshot'); },
    loadRunFile: async (runId, format) => {
      const bytes = files[`${runId}.${format}`];
      return bytes ? { bytes, filename: `shop-${runId.slice(0, 8)}-2026-10-24.${format}` } : null;
    },
    webhookSecretForRun: async () => (o.secret === undefined ? SECRET : o.secret),
  });
}
const get = (a: ReturnType<typeof createApp>, path: string, headers: Record<string, string> = {}) => a.fetch(new Request(`http://localhost${path}`, { headers }));
const bytesOf = async (res: Response) => Buffer.from(await res.arrayBuffer());

describe('GET /export/runs/:file — signed links', () => {
  it.each(['csv', 'json', 'xlsx'])('a valid link opens the %s snapshot with no session', async (format) => {
    const res = await get(app({ session: null }), link(format));
    expect(res.status).toBe(200);
    expect((await bytesOf(res)).equals(SNAP[`${RUN}.${format}`]!)).toBe(true);
    expect(res.headers.get('content-disposition')).toBe(`attachment; filename="shop-3f1c2b4a-2026-10-24.${format}"`);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });
  it.each([
    ['a wrong signature', `/export/runs/${RUN}.csv?expires=${NOW_S + 3600}&sig=${'0'.repeat(64)}`],
    ['an expired link', link('csv', { expires: NOW_S - 1 })],
    ['a link for another run', link('csv', { runId: OTHER })],
    ['a replaced secret', link('csv', { secret: 'cd'.repeat(32) })],
    ['RF5: a link signed for the CSV does not open the JSON', link('json', { signedFormat: 'csv' })],
    ['a signature with no expiry', `/export/runs/${RUN}.csv?sig=${sign(SECRET, RUN, 'csv', NOW_S + 3600)}`],
    ['an expiry with no signature', `/export/runs/${RUN}.csv?expires=${NOW_S + 3600}`],
  ])('404 for %s', async (_why, path) => {
    expect((await get(app({ session: null }), path)).status).toBe(404);
  });
  it('a website with no secret has no signed links', async () => {
    expect((await get(app({ session: null, secret: null }), link('csv'))).status).toBe(404);
  });
  it('a signed link never falls back to the session or the live file', async () => {
    const res = await get(app({ files: {} }), link('csv'), { cookie: 'robot_session=valid-token' });
    expect(res.status).toBe(404);
  });
  it('a bad link answers exactly what a missing run does (no oracle)', async () => {
    const missing = await get(app({ session: null, files: {} }), link('csv'));
    const wrong = await get(app({ session: null }), link('csv', { secret: 'cd'.repeat(32) }));
    expect([wrong.status, await wrong.text()]).toEqual([missing.status, await missing.text()]);
  });
  it('a signed link never reads the session', async () => {
    const a = createApp({
      loadSession: async () => { throw new Error('a signed link must not read the session'); },
      orgIdForRun: async () => { throw new Error('a signed link must not read the org'); },
      loadRunExport: async () => { throw new Error('no live export'); },
      loadRunFile: async () => ({ bytes: SNAP[`${RUN}.csv`]!, filename: 'x.csv' }),
      webhookSecretForRun: async () => SECRET,
    });
    expect((await get(a, link('csv'), { cookie: 'robot_session=valid-token' })).status).toBe(200);
  });
});

describe('GET /export/runs/:file?snapshot=1 — with the session', () => {
  it('serves the snapshot, not the live rows', async () => {
    const res = await get(app(), `/export/runs/${RUN}.csv?snapshot=1`, { cookie: 'robot_session=valid-token' });
    expect(res.status).toBe(200);
    expect((await bytesOf(res)).equals(SNAP[`${RUN}.csv`]!)).toBe(true);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });
  it('401 without a session, 404 for another organisation', async () => {
    expect((await get(app({ session: null }), `/export/runs/${RUN}.csv?snapshot=1`)).status).toBe(401);
    expect((await get(app({ orgId: 'org-2' }), `/export/runs/${RUN}.csv?snapshot=1`, { cookie: 'robot_session=valid-token' })).status).toBe(404);
  });
  it('RF5: ?snapshot=1 before the file is written is 404, never the live file', async () => {
    expect((await get(app({ files: {} }), `/export/runs/${RUN}.csv?snapshot=1`, { cookie: 'robot_session=valid-token' })).status).toBe(404);
  });
  it('a stored filename cannot break the header', async () => {
    const a = createApp({
      loadSession: async () => SESSION,
      orgIdForRun: async () => SESSION.org.id,
      loadRunExport: async () => { throw new Error('no live export'); },
      loadRunFile: async () => ({ bytes: SNAP[`${RUN}.csv`]!, filename: 'a"b\r\nX-Evil: 1\\.csv' }),
      webhookSecretForRun: async () => SECRET,
    });
    const res = await get(a, `/export/runs/${RUN}.csv?snapshot=1`, { cookie: 'robot_session=valid-token' });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-evil')).toBeNull();
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="a_b__X-Evil: 1_.csv"');
  });
});
