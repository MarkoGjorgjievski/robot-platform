// The two address checks for a website that exists (spec 2026-10-24 proxy §2.2, Task 4 fix round I1): "Find products"
// and the reachability line on a website's Verification and Extract tabs read that website's pages, so they go through
// its profile; an address alone (no website yet) stays direct. With `withBrowserSession` mocked (it records the
// profile and opens nothing) and `runAndWait` mocked (it records the job), no browser and no worker is involved.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, sources } from '@robot/db';
import { signedInCaller, type SignedIn } from '../test-helpers/identity.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';

const { seen, jobs } = vi.hoisted(() => ({ seen: [] as unknown[], jobs: [] as Array<{ type: string; payload: unknown; key: string | undefined }> }));
vi.mock('../browser-session.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../browser-session.js')>()),
  withBrowserSession: vi.fn(async (_fn: unknown, opts?: { profile?: unknown }) => {
    seen.push(opts && typeof opts === 'object' ? opts.profile : 'direct');
    throw new Error('address-checks: no browser in this test');
  }),
}));
vi.mock('../jobs/enqueue.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../jobs/enqueue.js')>()),
  runAndWait: vi.fn(async (type: string, payload: unknown, opts?: { key?: string }) => {
    jobs.push({ type, payload, key: opts?.key });
    return type === 'reachability'
      ? { url: 'x', verdict: { kind: 'ok' }, finalUrl: null, ms: 0, message: 'ok' }
      : { productLinks: 0, pagerSeen: false, products: [], message: null };
  }),
}));
const { reachabilityNow, listingCheckNow } = await import('../jobs/handlers/interactive.js');

const PROFILE = { proxy: { server: 'http://proxy.test:7000', username: 'u-country-de', password: 'secret' }, locale: 'de-DE', timezoneId: 'Europe/Berlin' };
const savedDefault = process.env.DEFAULT_PROXY_URL;
let me: SignedIn;
let other: SignedIn;
let site: Awaited<ReturnType<typeof createProjectWithSource>>;
let foreign: Awaited<ReturnType<typeof createProjectWithSource>>;
const url = 'https://test-proxy-address.example.com/p/1';
const listingUrl = 'https://test-proxy-address.example.com/c/lamps';

beforeAll(async () => {
  delete process.env.DEFAULT_PROXY_URL;
  me = await signedInCaller('proxy-address');
  other = await signedInCaller('proxy-address-other');
  site = await createProjectWithSource(me.caller, { tag: 'proxy-address', urls: [url], fields: [{ name: 'Title', type: 'text' }] });
  foreign = await createProjectWithSource(other.caller, { tag: 'proxy-address-other', fields: [{ name: 'Title', type: 'text' }] });
  await db.update(sources).set({ proxyUrl: 'http://u-country-{country}:secret@proxy.test:7000', country: 'de' }).where(eq(sources.id, site.sourceId));
});
afterAll(async () => {
  if (savedDefault === undefined) delete process.env.DEFAULT_PROXY_URL; else process.env.DEFAULT_PROXY_URL = savedDefault;
  await site?.cleanup();
  await foreign?.cleanup();
  await me?.cleanup();
  await other?.cleanup();
});

describe('the handlers (spec §2.2)', () => {
  it("reachability for a website goes through the website's profile; for an address alone, direct", async () => {
    seen.length = 0;
    await reachabilityNow(url, site.sourceId);
    await reachabilityNow(url);
    expect(seen).toEqual([PROFILE, 'direct']);
  });

  it("the listing check for a website goes through the website's profile; for an address alone, direct", async () => {
    seen.length = 0;
    await listingCheckNow(listingUrl, site.sourceId);
    await listingCheckNow(listingUrl);
    expect(seen).toEqual([PROFILE, 'direct']);
  });
});

describe('the procedures (spec §2.2)', () => {
  it('reachability carries the website to the job, keyed apart from the address alone', async () => {
    jobs.length = 0;
    await me.caller.sources.reachability({ url, sourceId: site.sourceId });
    await me.caller.sources.reachability({ url });
    expect(jobs.map((j) => j.payload)).toEqual([{ url, sourceId: site.sourceId }, { url }]);
    expect(jobs[0]!.key).not.toEqual(jobs[1]!.key);
  });

  it('the listing check carries the website to the job, keyed apart from the address alone', async () => {
    jobs.length = 0;
    await me.caller.sources.checkListingPage({ listingUrl, sourceId: site.sourceId });
    await me.caller.sources.checkListingPage({ listingUrl });
    expect(jobs.map((j) => j.payload)).toEqual([{ listingUrl, sourceId: site.sourceId }, { listingUrl }]);
    expect(jobs[0]!.key).not.toEqual(jobs[1]!.key);
  });

  it("another organisation's website is NOT_FOUND, and no job is queued", async () => {
    jobs.length = 0;
    await expect(me.caller.sources.reachability({ url, sourceId: foreign.sourceId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(me.caller.sources.checkListingPage({ listingUrl, sourceId: foreign.sourceId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(jobs).toEqual([]);
  });
});
