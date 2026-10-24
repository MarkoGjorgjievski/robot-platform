// No money in a customer answer (spec 2026-10-24 tenant isolation §2.3, §4.3): every scoped, org-wide and self query,
// called by a plain customer of org A on org A's own fixture (a run with a cost, a verification with a cost), carries
// no amount; the same calls by staff in staff mode still do. No call reaches the worker.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db, captures, extractions, runs } from '@robot/db';
import { appRouter } from '../routers/index.js';
import { enterAsStaff, signedInCaller, type SignedIn } from '../test-helpers/identity.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { PROCEDURE_CLASSES } from './procedure-classes.js';
import { buildTwoOrgs, type TwoOrgs } from './two-orgs.js';

vi.mock('../jobs/enqueue.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../jobs/enqueue.js')>()),
  runAndWait: async () => { throw new Error('money sweep: a call reached the worker'); },
}));
vi.mock('../jobs/queue.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../jobs/queue.js')>()),
  awaitJob: async () => { throw new Error('money sweep: a call waited on a job'); },
}));

process.env.CAPTURES_DIR = join(tmpdir(), 'robot-isolation-captures');

const MONEY_KEY = /usd|cost|spend|price(?!s?$)/i;
/** An amount written into text ("up to $0.36"), wherever it sits. */
const MONEY_TEXT = /\$\s?\d/;
/** Scraped or customer-typed data, never searched — a customer's own "price" field is theirs, not our money. Anchored
 *  per procedure to the exact answer paths that carry it (array indexes as `[*]`), so an amount of ours added anywhere
 *  else, even under a key of the same name, is still found. */
const CUSTOMER_DATA: Record<string, string[]> = {
  'runs.getWithDetails': ['extraction.data'],
  'sources.get': ['verificationSet.expected', 'verificationSet.defaults'],
  'projects.output': ['rows'],
  'crawl.items': ['items[*].listingValues'],
};

/** Every path in `v` whose key reads as money and whose value is an amount (a number or a numeric string), or whose
 *  text carries an amount — outside the procedure's customer data. */
function moneyPaths(v: unknown, procedure = '', path = ''): string[] {
  const skip = CUSTOMER_DATA[procedure] ?? [];
  if (skip.includes(path.replace(/\[\d+\]/g, '[*]'))) return [];
  if (typeof v === 'string') return MONEY_TEXT.test(v) ? [path] : [];
  if (Array.isArray(v)) return v.flatMap((x, i) => moneyPaths(x, procedure, `${path}[${i}]`));
  if (v === null || typeof v !== 'object' || v instanceof Date) return [];
  return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => {
    const here = path ? `${path}.${k}` : k;
    if (skip.includes(here.replace(/\[\d+\]/g, '[*]'))) return [];
    const amount = typeof x === 'number' || (typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x)));
    const flagged = MONEY_KEY.test(k) && amount;
    return [...(flagged ? [here] : []), ...moneyPaths(x, procedure, here).filter((p) => p !== here || !flagged)];
  });
}

describe('the scan itself', () => {
  it('finds an amount in text and our amount under a key named like customer data', () => {
    expect(moneyPaths({ label: 'up to $0.36', note: 'costs $ 4' })).toEqual(['label', 'note']);
    expect(moneyPaths({ fields: [{ key: 'price', perFieldUsd: 0.06 }] }, 'sources.verifyEstimate')).toEqual(['fields[0].perFieldUsd']);
    expect(moneyPaths({ rows: [{ costUsd: 1 }] }, 'runs.listByOrg')).toEqual(['rows[0].costUsd']);
  });
  it('leaves the anchored customer data alone, and only there', () => {
    const answer = { extraction: { data: [{ price: '$4.20', costUsd: 4.2 }] }, data: [{ costUsd: 1 }] };
    expect(moneyPaths(answer, 'runs.getWithDetails')).toEqual(['data[0].costUsd']);
    expect(moneyPaths({ verificationSet: { expected: { p: { u: '$4.20' } } } }, 'sources.get')).toEqual([]);
  });
});

/** What staff must still read, per procedure (spec §2.3's table, on this fixture: one project, one run, one staff action). */
const STAFF_MONEY: Record<string, string[]> = {
  'runs.listByOrg': ['[0].costUsd'],
  'sources.verificationStatus': ['costUsd'],
  'sources.verifyEstimate': ['perFieldUsd', 'upperBoundUsd'],
  'crawl.backfillPreview': ['estCostUsd'],
  'usage.byProject': ['projects[0].spendUsd', 'total.spendUsd'],
  'orgs.staffActivity': ['entries[0].run.costUsd'],
};

type Procedures = Record<string, { _def: { type: string } }>;
const procedures = (appRouter as unknown as { _def: { procedures: Procedures } })._def.procedures;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const at = (caller: unknown, path: string) => path.split('.').reduce<any>((node, key) => node[key], caller) as (input?: unknown) => Promise<unknown>;
const swept = Object.entries(PROCEDURE_CLASSES)
  .filter(([p, e]) => (e.class === 'scoped' || e.class === 'org-wide' || e.class === 'self') && procedures[p]!._def.type === 'query' && !(e.class === 'scoped' && e.works))
  .map(([p]) => p);

let t: TwoOrgs;
let op: SignedIn;
let staff: SignedIn;
const savedOps = process.env.OPS_EMAILS;
const inputFor = (path: string) => {
  const e = PROCEDURE_CLASSES[path]!;
  return 'input' in e && e.input ? e.input(t.a) : undefined;
};

beforeAll(async () => {
  t = await buildTwoOrgs({ tag: 'iso-money' });
  op = await signedInCaller('iso-money-op');
  process.env.OPS_EMAILS = op.user.email; // the operator only: org A's owner is a plain customer
  staff = await enterAsStaff(op, t.a.org.id);
}, 120_000);
afterAll(async () => {
  if (savedOps === undefined) delete process.env.OPS_EMAILS; else process.env.OPS_EMAILS = savedOps;
  await op?.cleanup();
  await t?.cleanup();
});

describe('a customer receives no amount (spec §2.3)', () => {
  it('the sweep calls every money-bearing procedure the spec names', () => {
    expect(swept).toEqual(expect.arrayContaining(Object.keys(STAFF_MONEY)));
  });

  it.each(swept)('%s carries no amount to a customer of the org', async (path) => {
    expect(moneyPaths(await at(t.a.owner.caller, path)(inputFor(path)), path)).toEqual([]);
  });
});

describe('staff in staff mode still read the amounts (spec §2.3)', () => {
  it.each(Object.entries(STAFF_MONEY))('%s gives staff %j', async (path, paths) => {
    expect(moneyPaths(await at(staff.caller, path)(inputFor(path)), path)).toEqual(expect.arrayContaining(paths));
  });
});

describe('RF5: a customer still reads their own money-named data', () => {
  it('RF5: a field called "Unit cost USD" keeps its values in the run rows and the expected values', async () => {
    const me = await signedInCaller('iso-money-rf5');
    try {
      const urls = [1, 2, 3].map((n) => `https://test-iso-money-rf5.example.com/p/${n}`);
      const site = await createProjectWithSource(me.caller, {
        tag: 'iso-money-rf5', urls,
        fields: [{ name: 'Unit cost USD', type: 'money' }],
        expected: { 'Unit cost USD': Object.fromEntries(urls.map((u) => [u, '4.20'])) },
      });
      const key = site.keys['Unit cost USD']!;
      const [run] = await db.insert(runs).values({ sourceId: site.sourceId, status: 'completed', completedAt: new Date(), resultCount: 1, costUsd: '0.5000' }).returning({ id: runs.id });
      const [cap] = await db.insert(captures).values({ sourceId: site.sourceId, runId: run!.id, url: urls[0]! }).returning({ id: captures.id });
      await db.insert(extractions).values({ sourceId: site.sourceId, captureId: cap!.id, runId: run!.id, data: [{ [key]: '4.20' }], rowCount: 1 });

      const details = await me.caller.runs.getWithDetails({ id: run!.id });
      expect((details!.extraction!.data as Array<Record<string, unknown>>)[0]).toMatchObject({ [key]: '4.20' });
      const got = await me.caller.sources.get({ projectSlug: site.projectSlug, sourceSlug: site.sourceSlug });
      expect((got.verificationSet as { expected: Record<string, Record<string, string>> }).expected[key]![urls[0]!]).toBe('4.20');
      // …while our amount for the same run is gone.
      expect((await me.caller.runs.listByOrg())[0]).not.toHaveProperty('costUsd');
    } finally {
      await me.cleanup();
    }
  });
});
