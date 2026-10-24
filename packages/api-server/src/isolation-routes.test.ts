// Tenant isolation, file routes (spec 2026-10-24 §2.2, §4.2): org B's capture tile, run files (live and snapshot) and
// project files, against the real Hono app and database — 401 with no session, 404 to org A, 400 for a traversal,
// 200 to org B (so the fixture is real); a signed link opens B's snapshot by design, and every wrong one answers
// exactly what a missing run does.
import { createHmac, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, sources } from '@robot/db';
import { buildTwoOrgs, type TwoOrgs } from '@robot/api/isolation/two-orgs';
import { createApp } from './app.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
/** `serveStatic`'s root in app.ts: the tiles must be written where it serves them. */
const CAPTURES_PUBLIC_DIR = join(__dirname, '..', 'public', 'captures');
const FORMATS = ['csv', 'json', 'xlsx'] as const;
const sign = (secret: string, runId: string, format: string, expires: number) => createHmac('sha256', secret).update(`${runId}.${format}.${expires}`).digest('hex');
const inAnHour = () => Math.floor(Date.now() / 1000) + 3600;

describe.skipIf(!process.env.DATABASE_URL)('file routes across two organisations (spec 2026-10-24 tenant isolation §2.2)', () => {
  const app = createApp();
  let t: TwoOrgs;
  beforeAll(async () => { t = await buildTwoOrgs({ tag: 'iso-routes', capturesDir: CAPTURES_PUBLIC_DIR }); }, 120_000);
  afterAll(async () => { await t?.cleanup(); });

  const cookieOf = (f: TwoOrgs['a']) => `robot_session=${f.owner.session.token}`;
  const get = (path: string, cookie?: string) => app.fetch(new Request(`http://localhost${path}`, cookie ? { headers: { cookie } } : undefined));
  const bFiles = (): Array<[string, string]> => [
    ['the capture tile', `/captures/${t.b.tileFile}`],
    ...FORMATS.map((f): [string, string] => [`the run's ${f}`, `/export/runs/${t.b.runId}.${f}`]),
    ...FORMATS.map((f): [string, string] => [`the run's ${f} snapshot`, `/export/runs/${t.b.runId}.${f}?snapshot=1`]),
    ...FORMATS.map((f): [string, string] => [`the project's ${f}`, `/export/projects/${t.b.projectId}.${f}`]),
  ];

  it("every file of B's: 401 with no session, 404 to org A, 200 to org B", async () => {
    for (const [what, path] of bFiles()) {
      expect((await get(path)).status, `${what}, no session`).toBe(401);
      expect((await get(path, cookieOf(t.a))).status, `${what}, org A`).toBe(404);
      expect((await get(path, cookieOf(t.b))).status, `${what}, org B`).toBe(200);
    }
  });

  it.each(['..%2f', '%2e%2e%2f', '..%5c', '%2e%2e%5c', 'x%2f'])("a traversal (%s) towards B's tile is 400, signed in or not", async (prefix) => {
    const path = `/captures/${prefix}${t.b.tileFile}`;
    expect((await get(path)).status).toBe(400);
    expect((await get(path, cookieOf(t.a))).status).toBe(400);
  });

  it("a signed link opens B's snapshot with no session — by design", async () => {
    const exp = inAnHour();
    const res = await get(`/export/runs/${t.b.runId}.csv?expires=${exp}&sig=${sign(t.b.webhookSecret, t.b.runId, 'csv', exp)}`);
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe(`${t.b.tag}:csv`);
  });

  it('every wrong signed link answers exactly what a missing run does', async () => {
    const exp = inAnHour();
    const past = Math.floor(Date.now() / 1000) - 1;
    const good = sign(t.b.webhookSecret, t.b.runId, 'csv', exp);
    const missingRun = randomUUID();
    const missing = await get(`/export/runs/${missingRun}.csv?expires=${exp}&sig=${sign(t.b.webhookSecret, missingRun, 'csv', exp)}`);
    const expected = [missing.status, await missing.text()];
    expect(expected[0]).toBe(404);
    const cases: Array<[string, string]> = [
      ['a tampered signature', `/export/runs/${t.b.runId}.csv?expires=${exp}&sig=${good.slice(0, -1)}${good.endsWith('0') ? '1' : '0'}`],
      ['an expired link', `/export/runs/${t.b.runId}.csv?expires=${past}&sig=${sign(t.b.webhookSecret, t.b.runId, 'csv', past)}`],
      ["another run's signature", `/export/runs/${t.b.runId}.csv?expires=${exp}&sig=${sign(t.b.webhookSecret, t.a.runId, 'csv', exp)}`],
      ["org A's secret", `/export/runs/${t.b.runId}.csv?expires=${exp}&sig=${sign(t.a.webhookSecret, t.b.runId, 'csv', exp)}`],
      ['the wrong format', `/export/runs/${t.b.runId}.json?expires=${exp}&sig=${good}`],
    ];
    for (const [why, path] of cases) {
      const res = await get(path);
      expect([res.status, await res.text()], why).toEqual(expected);
    }
  });

  it('a link signed before the secret was rotated answers the same 404', async () => {
    const exp = inAnHour();
    const before = sign(t.b.webhookSecret, t.b.runId, 'csv', exp);
    await db.update(sources).set({ webhookSecret: 'ef'.repeat(32) }).where(eq(sources.id, t.b.sourceId));
    try {
      expect((await get(`/export/runs/${t.b.runId}.csv?expires=${exp}&sig=${before}`)).status).toBe(404);
    } finally {
      await db.update(sources).set({ webhookSecret: t.b.webhookSecret }).where(eq(sources.id, t.b.sourceId));
    }
  });
});
