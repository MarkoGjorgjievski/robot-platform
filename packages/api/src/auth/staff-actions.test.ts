import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, sources, staffActions } from '@robot/db';
import { appRouter } from '../routers/index.js';
import { createCallerFactory } from '../trpc.js';
import { loadSession } from './session.js';
import { signedInCaller, type SignedIn } from '../test-helpers/identity.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { STAFF_ACTIONS, logStaffMutation } from './staff-actions.js';

const procedures = (appRouter as unknown as { _def: { procedures: Record<string, { _def: { type: string } }> } })._def.procedures;

describe('every mutation has a sentence (spec 2026-10-07 §2.4)', () => {
  it('STAFF_ACTIONS has a key for every mutation and nothing else', () => {
    const mutations = Object.entries(procedures).filter(([, v]) => v._def.type === 'mutation').map(([p]) => p).sort();
    expect(Object.keys(STAFF_ACTIONS).sort()).toEqual(mutations);
  });
});

describe('the staff action log', () => {
  let staff: SignedIn;
  let customer: SignedIn;
  let inside: SignedIn;
  let sourceId: string;
  let projectSlug: string;
  let sourceSlug: string;
  const saved = process.env.OPS_EMAILS;
  const rows = async () => db.select().from(staffActions).where(eq(staffActions.orgId, customer.org.id)).orderBy(staffActions.at);

  beforeAll(async () => {
    staff = await signedInCaller('staff-log-op');
    customer = await signedInCaller('staff-log-cust');
    process.env.OPS_EMAILS = staff.user.email;
    ({ sourceId, projectSlug, sourceSlug } = await createProjectWithSource(customer.caller, {
      tag: 'staff-log',
      fields: [{ name: 'Price', type: 'money' }],
    }));
    const s0 = (await loadSession(db, staff.session.token))!;
    await createCallerFactory(appRouter)({ db, session: s0 }).ops.enterOrg({ sourceId });
    const s = (await loadSession(db, staff.session.token))!;
    inside = { ...staff, session: s, caller: createCallerFactory(appRouter)({ db, session: s }) };
  });
  beforeEach(async () => { await db.delete(staffActions).where(eq(staffActions.orgId, customer.org.id)); });
  afterAll(async () => {
    process.env.OPS_EMAILS = saved;
    await customer.cleanup();
    await staff.cleanup();
  });

  it('an allowed mutation writes one row with the right sentence and ids', async () => {
    const before = (await db.query.sources.findFirst({ where: eq(sources.id, sourceId), columns: { name: true } }))!.name;
    await inside.caller.sources.rename({ sourceId, name: 'Zalando EU' });
    const log = await rows();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ action: 'sources.rename', summary: `Renamed website ${before} to Zalando EU`, sourceId, userId: staff.user.id });
    expect(log[0]!.projectId).toBeTruthy();
  });

  it('queries write nothing', async () => {
    await inside.caller.projects.list();
    await inside.caller.sources.get({ projectSlug, sourceSlug });
    expect(await rows()).toHaveLength(0);
  });

  it('a mutation that fails writes nothing', async () => {
    await expect(inside.caller.sources.rename({ sourceId: '00000000-0000-4000-8000-000000000000', name: 'X' })).rejects.toBeTruthy();
    expect(await rows()).toHaveLength(0);
  });

  it('own-account changes are not logged', async () => {
    await inside.caller.auth.updateName({ name: 'Staff Person' });
    expect(await rows()).toHaveLength(0);
  });

  it('the same mutation outside staff mode writes nothing', async () => {
    await customer.caller.sources.rename({ sourceId, name: 'Zalando' });
    expect(await rows()).toHaveLength(0);
  });

  it('Verification autosave is logged at most once per 10 minutes (ruling R1)', async () => {
    const call = { db, session: inside.session, path: 'sources.updateBinding', input: { sourceId }, result: undefined, before: undefined };
    await logStaffMutation(call);
    await logStaffMutation(call);
    expect((await rows()).map((r) => r.summary)).toEqual([expect.stringMatching(/^Edited the Verification answers on /)]);
  });
});

describe('the sentence table', () => {
  const target = { website: { id: 's', name: 'Nike', projectId: 'p' }, project: { id: 'p', name: 'Shoes' } };
  const say = (path: string, input: unknown, result: unknown = undefined, before: unknown = undefined) =>
    STAFF_ACTIONS[path]!.describe({ db, input, result, before, target });

  it.each([
    ['crawl.plan', { sourceId: 's', probe: true }, { runId: 'r' }, undefined, 'Tried a sample on Nike'],
    ['crawl.plan', { sourceId: 's' }, { runId: 'r' }, { budget: 50 }, 'Planned an extraction on Nike (budget 50 products)'],
    ['crawl.plan', { sourceId: 's' }, { runId: 'r' }, { budget: 'all' }, 'Planned an extraction on Nike (budget all products)'],
    ['crawl.probeAndSample', { sourceId: 's' }, undefined, undefined, 'Ran a sample on Nike'],
    ['crawl.execute', { runId: 'r' }, undefined, undefined, 'Ran an extraction on Nike'],
    ['crawl.execute', { runId: 'r', retryFailed: true }, undefined, undefined, 'Retried the failed pages of a run on Nike'],
    ['crawl.cancel', { runId: 'r' }, undefined, undefined, 'Cancelled a run on Nike'],
    ['crawl.backfill', { runId: 'r' }, undefined, undefined, 'Filled in missing values on Nike'],
    ['datasets.addField', { datasetId: 'd', name: 'Size' }, undefined, undefined, 'Added field Size to Shoes'],
    ['datasets.renameField', { datasetId: 'd', key: 'price', name: 'Sale price' }, undefined, { name: 'Price' }, 'Renamed field Price to Sale price'],
    ['datasets.retypeField', { datasetId: 'd', key: 'price', type: 'number' }, undefined, { name: 'Price' }, 'Changed field Price to number'],
    ['datasets.setVariantMode', { datasetId: 'd', mode: 'row_per_variant' }, undefined, undefined, 'Set variants on Shoes to one row per variant'],
    ['datasets.setFieldLevel', { datasetId: 'd', key: 'price', level: 'variant' }, undefined, { name: 'Price' }, 'Set Price to be read per variant'],
    ['datasets.setFieldLevel', { datasetId: 'd', key: 'price', level: null }, undefined, { name: 'Price' }, 'Reset where Price is read'],
    ['datasets.addAxis', { datasetId: 'd', name: 'Colour' }, undefined, undefined, 'Added variant column Colour'],
    ['datasets.renameAxis', { datasetId: 'd', key: 'colour', name: 'Shade' }, undefined, { name: 'Colour' }, 'Renamed variant column Colour to Shade'],
    ['projects.create', { name: 'Shoes' }, undefined, undefined, 'Created project Shoes'],
    ['projects.rename', { projectId: 'p', name: 'Sneakers' }, undefined, { name: 'Shoes' }, 'Renamed project Shoes to Sneakers'],
    ['sources.createInProject', { projectSlug: 'shoes', name: 'Zalando', url: 'https://zalando.de' }, { sourceId: 's2' }, undefined, 'Added website Zalando'],
    ['sources.rename', { sourceId: 's', name: 'Zalando EU' }, undefined, { name: 'Zalando' }, 'Renamed website Zalando to Zalando EU'],
    ['sources.update', { id: 's', isActive: false }, undefined, undefined, "Changed Nike's settings"],
    ['sources.setListingPages', { sourceId: 's', urls: ['https://nike.com/l'] }, undefined, undefined, 'Changed the listing pages of Nike'],
    ['sources.setProductUrls', { sourceId: 's', urls: ['https://nike.com/p/1', 'https://nike.com/p/2'] }, undefined, undefined, 'Changed the product list of Nike (2 URLs)'],
    ['sources.updateBinding', { sourceId: 's' }, undefined, undefined, 'Edited the Verification answers on Nike'],
    ['sources.checkListingPage', { listingUrl: 'https://nike.com/l' }, undefined, undefined, 'Checked listing page https://nike.com/l'],
    ['sources.captureProofPage', { sourceId: 's', url: 'https://nike.com/p/1' }, undefined, undefined, 'Captured a proof page on Nike'],
    ['sources.transferMarks', { sourceId: 's', fromUrl: 'https://nike.com/p/1', toUrls: ['https://nike.com/p/2'] }, undefined, undefined, 'Carried answers to other proof pages on Nike'],
    ['sources.confirm', { sourceId: 's' }, undefined, undefined, 'Confirmed the setup of Nike'],
    ['sources.verify', { sourceId: 's' }, undefined, undefined, 'Verified Nike'],
    ['sources.verify', { sourceId: 's', onlyKeys: [] }, undefined, undefined, 'Verified Nike'],
    ['sources.verify', { sourceId: 's', onlyKeys: ['price'] }, undefined, { fieldNames: { price: 'Price' } }, 'Re-verified Price on Nike'],
    ['sources.checkDrift', { sourceId: 's' }, undefined, undefined, 'Checked Nike for changes'],
    ['sources.setVariantSetup', { sourceId: 's', method: 'none', axes: [] }, undefined, undefined, 'Set up variants on Nike'],
    ['sources.saveVariantAnswer', { sourceId: 's', url: 'https://nike.com/p/1', answer: null }, undefined, undefined, 'Answered a variant question on Nike'],
  ])('%s → %s', async (path, input, result, before, expected) => {
    expect(await say(path, input, result, before)).toBe(expected);
  });
});
