// Every website-scoped page load opens its browser with the website's profile (spec 2026-10-24 proxy §2.2, §4 "API"):
// with `withBrowserSession` mocked — it records the profile and opens nothing — the cheap call sites are called for real,
// and every website-scoped file is read to prove it has no other way to open a browser. Reachability and the listing
// check alone stay direct (§3.4).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { db, runs, sources, sourceVerifications } from '@robot/db';
import { signedInCaller, type SignedIn } from '../test-helpers/identity.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';

const { seen } = vi.hoisted(() => ({ seen: [] as unknown[] }));
vi.mock('../browser-session.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../browser-session.js')>()),
  withBrowserSession: vi.fn(async (_fn: unknown, opts?: { profile?: unknown }) => {
    seen.push(opts && typeof opts === 'object' ? opts.profile : undefined);
    throw new Error('call-sites: no browser in this test');
  }),
}));
const { forWebsite } = await import('./website-session.js');
const { startProofPageCapture, runProofPageCapture } = await import('../verify/proof-page-capture.js');
const { runSourceVerification } = await import('../verify/run-source-verification.js');
const { planSource } = await import('../crawl/plan-source.js');
const { startExecution } = await import('../crawl/start-execution.js');

const SRC = fileURLToPath(new URL('..', import.meta.url));
const PROFILE = { proxy: { server: 'http://proxy.test:7000', username: 'u-country-de', password: 'secret' }, locale: 'de-DE', timezoneId: 'Europe/Berlin' };
const savedKey = process.env.ANTHROPIC_API_KEY;
const savedDefault = process.env.DEFAULT_PROXY_URL;
let me: SignedIn;
let site: Awaited<ReturnType<typeof createProjectWithSource>>;
const urls = [1, 2, 3].map((n) => `https://test-proxy-calls.example.com/p/${n}`);

beforeAll(async () => {
  delete process.env.ANTHROPIC_API_KEY; // no agent is built anywhere here
  delete process.env.DEFAULT_PROXY_URL;
  me = await signedInCaller('proxy-calls');
  site = await createProjectWithSource(me.caller, { tag: 'proxy-calls', urls, fields: [{ name: 'Title', type: 'text' }], expected: { Title: Object.fromEntries(urls.map((u, i) => [u, `Lamp ${i + 1}`])) } });
  await db.update(sources).set({ proxyUrl: 'http://u-country-{country}:secret@proxy.test:7000', country: 'de' }).where(eq(sources.id, site.sourceId));
});
afterAll(async () => {
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = savedKey;
  if (savedDefault === undefined) delete process.env.DEFAULT_PROXY_URL; else process.env.DEFAULT_PROXY_URL = savedDefault;
  await site?.cleanup();
  await me?.cleanup();
});
const last = () => seen[seen.length - 1];

describe('forWebsite (spec §2.2)', () => {
  it('opens the session with the website’s profile', async () => {
    seen.length = 0;
    await expect(forWebsite(site.sourceId)(async () => 1)).rejects.toThrow('no browser');
    expect(seen).toEqual([PROFILE]);
  });

  it('a website whose address cannot be used never opens a browser at all', async () => {
    await db.update(sources).set({ country: null }).where(eq(sources.id, site.sourceId));
    try {
      seen.length = 0;
      await expect(forWebsite(site.sourceId)(async () => 1)).rejects.toMatchObject({ kind: 'proxy', message: 'The proxy refused the connection.' });
      expect(seen).toEqual([]);
    } finally {
      await db.update(sources).set({ country: 'de' }).where(eq(sources.id, site.sourceId));
    }
  });
});

describe('the call sites (spec §2.2, every website-scoped page load)', () => {
  it('a proof-page capture', async () => {
    seen.length = 0;
    const { captureId } = await startProofPageCapture(site.sourceId, urls[0]!, { fire: false });
    await runProofPageCapture(captureId);
    expect(last()).toEqual(PROFILE);
  });

  it('a Verify', async () => {
    seen.length = 0;
    const [row] = await db.insert(sourceVerifications).values({ sourceId: site.sourceId, definitionHash: 'proxy-calls', completedAt: null }).returning({ id: sourceVerifications.id });
    await runSourceVerification(site.sourceId, row!.id, { startCoverage: vi.fn(async () => ({ checkId: 'none', status: 'started' as const })), startCheck: vi.fn(async () => undefined) });
    expect(last()).toEqual(PROFILE);
  });

  it('planning a run', async () => {
    seen.length = 0;
    await planSource(db, site.sourceId).catch(() => undefined);
    expect(last()).toEqual(PROFILE);
  });

  it('a run', async () => {
    seen.length = 0;
    const [run] = await db.insert(runs).values({ sourceId: site.sourceId, status: 'extracting' }).returning({ id: runs.id });
    await startExecution(run!.id, site.sourceId, []);
    expect(last()).toEqual(PROFILE);
  });
});

/** Code with comments removed, so a comment that mentions a call is never counted. */
const code = (file: string) => readFileSync(join(SRC, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const WEBSITE_SCOPED = [
  'verify/proof-page-capture.ts', 'verify/run-source-verification.ts', 'crawl/plan-source.ts', 'crawl/start-execution.ts',
  'verify/run-drift-check.ts', 'verify/run-coverage-check.ts', 'verify/website-checks.ts', 'jobs/handlers/interactive.ts',
];

describe('no website-scoped file opens a browser any other way (spec §2.2)', () => {
  it.each(WEBSITE_SCOPED)('%s', (file) => {
    const src = code(file);
    const direct = src.match(/\bwithBrowserSession\(|\bsession\(/g) ?? [];
    // An address check with no website (Add website) is the one direct session (spec §2.2, §3.4; fix round I1).
    expect(direct.length, `${file} opens a browser without the website's profile`).toBe(file === 'jobs/handlers/interactive.ts' ? 1 : 0);
  });

  it("the one direct session is an address check with no website; with one, the website's", () => {
    const src = code('jobs/handlers/interactive.ts');
    const body = (name: string) => src.slice(src.indexOf(`function ${name}`), src.indexOf('\nexport ', src.indexOf(`function ${name}`) + 1));
    expect(body('addressSession')).toMatch(/sourceId \? forWebsite\(sourceId\) : \(fn\) => withBrowserSession\(fn\)/);
    expect(body('listingCheckNow')).toMatch(/\baddressSession\(sourceId\)\(/);
    expect(body('reachabilityNow')).toMatch(/\baddressSession\(sourceId\)\(/);
    for (const name of ['transferMarksNow', 'detectVariantsNow', 'variantLinksNearNow']) expect(body(name)).toMatch(/\bforWebsite\(/);
  });
});
