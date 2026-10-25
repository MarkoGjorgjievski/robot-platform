// A website's proxy and country, set and read (spec 2026-10-24 proxy §2.3): staff set them — an operator, or staff in
// staff mode, logged in staff words — a customer is refused and reads neither, not even in their own calls' answers.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, sources, staffActions } from '@robot/db';
import { enterAsStaff, signedInCaller, type SignedIn } from '../test-helpers/identity.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';

const OWN = 'http://shop-user-country-{country}:s3cret-pass@proxy.test:7000';
const SECRET = /s3cret|proxy\.test|shop-user/;
const urls = [1, 2, 3].map((n) => `https://test-net.example.com/p/${n}`);
let op: SignedIn;
let customer: SignedIn;
let staff: SignedIn;
let site: Awaited<ReturnType<typeof createProjectWithSource>>;
const saved = { ops: process.env.OPS_EMAILS, def: process.env.DEFAULT_PROXY_URL };
const rowOf = async () => (await db.query.sources.findFirst({ where: eq(sources.id, site.sourceId), columns: { proxyUrl: true, country: true, isActive: true } }))!;
const logOf = async () => (await db.select().from(staffActions).where(eq(staffActions.orgId, customer.org.id)).orderBy(staffActions.at))
  .filter((r) => r.action === 'sources.update').map((r) => r.summary);
const get = (who: SignedIn) => who.caller.sources.get({ projectSlug: site.projectSlug, sourceSlug: site.sourceSlug });

beforeAll(async () => {
  op = await signedInCaller('net-op');
  customer = await signedInCaller('net-cust');
  process.env.OPS_EMAILS = op.user.email;
  delete process.env.DEFAULT_PROXY_URL;
  site = await createProjectWithSource(customer.caller, { tag: 'net', urls, fields: [{ name: 'Title', type: 'text' }] });
  staff = await enterAsStaff(op, customer.org.id);
});
afterEach(async () => {
  await db.update(sources).set({ proxyUrl: null, country: null, isActive: true }).where(eq(sources.id, site.sourceId));
  delete process.env.DEFAULT_PROXY_URL;
});
afterAll(async () => {
  if (saved.ops === undefined) delete process.env.OPS_EMAILS; else process.env.OPS_EMAILS = saved.ops;
  if (saved.def === undefined) delete process.env.DEFAULT_PROXY_URL; else process.env.DEFAULT_PROXY_URL = saved.def;
  await site?.cleanup();
  await customer?.cleanup();
  await op?.cleanup();
});

describe('a new website (spec §2.1; final review I3)', () => {
  // Written at create as every website before it was: the same en-US / New York browser, and a default address that
  // fills in {country} reads "us" rather than failing every page of a website staff never opened.
  it('reads country "us", as every website before it', async () => {
    const fresh = await createProjectWithSource(customer.caller, { tag: 'net-new', urls, fields: [{ name: 'Title', type: 'text' }] });
    try {
      const row = await db.query.sources.findFirst({ where: eq(sources.id, fresh.sourceId), columns: { country: true, proxyUrl: true } });
      expect(row).toEqual({ country: 'us', proxyUrl: null });
    } finally { await fresh.cleanup(); }
  });
});

describe('sources.update and sources.get (spec §2.3)', () => {
  it('staff set the proxy and the country; staff read the masked address, a customer neither key', async () => {
    await staff.caller.sources.update({ id: site.sourceId, proxyUrl: OWN, country: 'DE' });
    expect(await rowOf()).toMatchObject({ proxyUrl: OWN, country: 'de' });
    const s = await get(staff);
    expect(s).toMatchObject({ proxyUrl: 'http://shop-user-country-{country}:•••@proxy.test:7000', proxyFromDefault: false, country: 'de', networkProblem: null });
    expect(s.countries).toHaveLength(20);
    expect(s.countries).toContainEqual({ code: 'de', name: 'Germany' });
    expect(JSON.stringify(s)).not.toMatch(/s3cret/);
    const c = await get(customer);
    for (const k of ['proxyUrl', 'proxyFromDefault', 'country', 'countries', 'networkProblem']) expect(c).not.toHaveProperty(k);
    expect(JSON.stringify(c)).not.toMatch(SECRET);
  });

  it('with no address of its own the website reads the default; "Use the default" clears its own', async () => {
    process.env.DEFAULT_PROXY_URL = 'http://d:dpass@default.proxy.test:8000';
    expect(await get(staff)).toMatchObject({ proxyUrl: 'http://d:•••@default.proxy.test:8000', proxyFromDefault: true });
    await staff.caller.sources.update({ id: site.sourceId, proxyUrl: 'http://own.proxy.test:7000' });
    expect(await get(staff)).toMatchObject({ proxyUrl: 'http://own.proxy.test:7000', proxyFromDefault: false });
    await staff.caller.sources.update({ id: site.sourceId, proxyUrl: null });
    expect((await rowOf()).proxyUrl).toBeNull();
    expect(await get(staff)).toMatchObject({ proxyFromDefault: true });
  });

  it('a customer is refused for those fields with nothing written; their other calls still work', async () => {
    await expect(customer.caller.sources.update({ id: site.sourceId, proxyUrl: OWN })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(customer.caller.sources.update({ id: site.sourceId, country: 'de', isActive: false })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await rowOf()).toMatchObject({ proxyUrl: null, country: null, isActive: true });
    await customer.caller.sources.update({ id: site.sourceId, isActive: false });
    expect((await rowOf()).isActive).toBe(false);
  });

  it('a refusal is one staff sentence, and nothing is written', async () => {
    for (const [bad, sentence] of [
      ['ftp://gate.provider.com:21', 'Use an address like http://user:pass@host:port.'],
      ['http://gate.provider.com', 'Use an address like http://user:pass@host:port.'],
      ['http://user-{city}:p@gate.provider.com:7000', 'Only {country} can be filled in.'],
      ['socks5://u:p@10.0.0.5:1080', 'A socks5 proxy cannot take a user and password here. Use http:// or https://, or socks5://host:port.'],
      [`http://u:${'p'.repeat(1000)}@gate.provider.com:7000`, 'Use an address like http://user:pass@host:port.'],
    ] as const) {
      await expect(staff.caller.sources.update({ id: site.sourceId, proxyUrl: bad })).rejects.toMatchObject({ code: 'BAD_REQUEST', message: sentence });
    }
    await expect(staff.caller.sources.update({ id: site.sourceId, country: 'zz' })).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'Choose a country from the list.' });
    expect(await rowOf()).toMatchObject({ proxyUrl: null, country: null });
  });

  it('RF1: an own address with {country} needs a country, at save and when the country is cleared', async () => {
    const needs = "This website's proxy address fills in {country}, so it needs a country.";
    await expect(staff.caller.sources.update({ id: site.sourceId, proxyUrl: OWN })).rejects.toMatchObject({ code: 'BAD_REQUEST', message: needs });
    await staff.caller.sources.update({ id: site.sourceId, proxyUrl: OWN, country: 'de' });
    await expect(staff.caller.sources.update({ id: site.sourceId, country: null })).rejects.toMatchObject({ code: 'BAD_REQUEST', message: needs });
    expect(await rowOf()).toMatchObject({ proxyUrl: OWN, country: 'de' });
    await staff.caller.sources.update({ id: site.sourceId, proxyUrl: null, country: null });
    expect(await rowOf()).toMatchObject({ proxyUrl: null, country: null });
  });

  it('RF4: a customer’s own updates never answer with the proxy', async () => {
    await db.update(sources).set({ proxyUrl: OWN, country: 'de' }).where(eq(sources.id, site.sourceId));
    const answers = [
      await customer.caller.sources.update({ id: site.sourceId, isActive: false }),
      await customer.caller.sources.updateBinding({
        sourceId: site.sourceId, urls,
        descriptions: { [site.keys.Title!]: 'the heading' },
        expected: { [site.keys.Title!]: Object.fromEntries(urls.map((u) => [u, 'A product'])) },
      }),
      await staff.caller.sources.update({ id: site.sourceId, isActive: true }),
    ];
    for (const a of answers) {
      expect(a).not.toHaveProperty('proxyUrl');
      expect(a).not.toHaveProperty('country');
      expect(JSON.stringify(a)).not.toMatch(SECRET);
    }
  });
});

describe('the staff log (spec §2.3 "Logging")', () => {
  it('staff changes read in staff words; the customer reads that a setting changed', async () => {
    const settingChanges = async () => (await customer.caller.orgs.staffActivity({ page: 0 })).entries.filter((e) => e.summary === 'Changed a setting of this website').length;
    const before = await settingChanges(); // the tests above made staff changes of their own
    await staff.caller.sources.update({ id: site.sourceId, country: 'de' });
    await staff.caller.sources.update({ id: site.sourceId, proxyUrl: OWN });
    await staff.caller.sources.update({ id: site.sourceId, proxyUrl: null });
    await staff.caller.sources.update({ id: site.sourceId, country: null });
    expect((await logOf()).slice(-4)).toEqual([
      "Set the website's country to Germany", "Set the website's proxy", "Set the website's proxy to the default", "Set the website's country to no preference",
    ]);
    const mine = await customer.caller.orgs.staffActivity({ page: 0 });
    expect(mine.entries.filter((e) => e.summary === 'Changed a setting of this website')).toHaveLength(before + 4);
    expect(JSON.stringify(mine)).not.toMatch(/proxy|Germany|country|preference/i);
    const ops = await op.caller.ops.staffActivity({ orgId: customer.org.id });
    expect(ops.entries.map((e) => e.summary)).toEqual(expect.arrayContaining(["Set the website's country to Germany", "Set the website's proxy"]));
  });

  it('other settings keep their words for everyone', async () => {
    await staff.caller.sources.update({ id: site.sourceId, isActive: false });
    const mine = await customer.caller.orgs.staffActivity({ page: 0 });
    expect(mine.entries[0]!.summary).toMatch(/^Changed .*'s settings$/);
  });
});

describe('ops.website (spec §2.3 "Ops")', () => {
  it('says own, default or none, and the country', async () => {
    expect((await op.caller.ops.website({ sourceId: site.sourceId })).network).toEqual({ proxy: 'none', country: null });
    process.env.DEFAULT_PROXY_URL = 'http://default.proxy.test:8000';
    expect((await op.caller.ops.website({ sourceId: site.sourceId })).network).toEqual({ proxy: 'default', country: null });
    await db.update(sources).set({ proxyUrl: OWN, country: 'de' }).where(eq(sources.id, site.sourceId));
    expect((await op.caller.ops.website({ sourceId: site.sourceId })).network).toEqual({ proxy: 'own', country: { code: 'de', name: 'Germany' } });
    expect(JSON.stringify(await op.caller.ops.website({ sourceId: site.sourceId }))).not.toMatch(/s3cret/);
  });
});
