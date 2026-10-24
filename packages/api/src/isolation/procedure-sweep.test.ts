// Tenant isolation, as a test (spec 2026-10-24 §2.1, §4.1): every tRPC procedure is classified, and each is called
// across two throwaway organisations. A procedure missing from the table fails here — a new one must say how it is
// scoped before it can merge. No call may reach the worker: `runAndWait` and `awaitJob` throw, and every call below
// must leave org B's rows and the test queue exactly as they were.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db } from '@robot/db';
import { appRouter } from '../routers/index.js';
import { createCallerFactory } from '../trpc.js';
import { enterAsStaff, signIn, signedInCaller } from '../test-helpers/identity.js';
import { PROCEDURE_CLASSES, type ProcedureEntry } from './procedure-classes.js';
import { buildTwoOrgs, needlesOf, queuedJobCount, snapshotOrg, type OrgFixture, type TwoOrgs } from './two-orgs.js';

vi.mock('../jobs/enqueue.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../jobs/enqueue.js')>()),
  runAndWait: async () => { throw new Error('procedure sweep: a call reached the worker'); },
}));
vi.mock('../jobs/queue.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../jobs/queue.js')>()),
  awaitJob: async () => { throw new Error('procedure sweep: a call waited on a job'); },
}));

process.env.CAPTURES_DIR = join(tmpdir(), 'robot-isolation-captures');

type Procedures = Record<string, { _def: { type: 'query' | 'mutation' | 'subscription' } }>;
const procedures = (appRouter as unknown as { _def: { procedures: Procedures } })._def.procedures;
const createCaller = createCallerFactory(appRouter);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const at = (caller: unknown, path: string) => path.split('.').reduce<any>((node, key) => node[key], caller) as (input?: unknown) => Promise<unknown>;
const pathsOf = (cls: ProcedureEntry['class']) => Object.entries(PROCEDURE_CLASSES).filter(([, e]) => e.class === cls).map(([p]) => p);
function entry<C extends ProcedureEntry['class']>(path: string, cls: C): Extract<ProcedureEntry, { class: C }> {
  const e = PROCEDURE_CLASSES[path]!;
  if (e.class !== cls) throw new Error(`${path} is ${e.class}, not ${cls}`);
  return e as Extract<ProcedureEntry, { class: C }>;
}

type Settled = { ok: true; value: unknown } | { ok: false; error: { code?: string; message: string } };
async function settle(p: Promise<unknown>): Promise<Settled> {
  try { return { ok: true, value: await p }; } catch (e) { return { ok: false, error: e as { code?: string; message: string } }; }
}
const codeOf = (s: Settled) => (s.ok ? 'answered' : s.error.code);
function namesNothingOf(answer: unknown, needles: string[], label: string) {
  const text = JSON.stringify(answer) ?? '';
  for (const n of needles) expect(text.includes(n), `${label} names ${n} of the other organisation`).toBe(false);
}

/** An org that does not exist: every id a fresh uuid, every slug, name, key and address one nobody has. */
function ghostOf(f: OrgFixture): OrgFixture {
  const g = `ghost-${randomUUID().slice(0, 8)}`;
  const host = `${g}.example.com`;
  const id = () => randomUUID();
  return {
    ...f, tag: g, org: { id: id(), slug: g, name: g },
    projectId: id(), projectSlug: `${g}-project`, projectName: g, datasetId: id(),
    sourceId: id(), sourceSlug: `${g}-site`, sourceName: g, host, urls: f.urls.map((_, i) => `https://${host}/p/${i + 1}`),
    keys: { title: `${g}_title`, price: `${g}_price` }, axisKey: `${g}_axis`,
    runId: id(), itemIds: f.itemIds.map(id), runCaptureId: id(), captureId: id(), tileFile: `${g}.png`,
    verificationId: id(), driftCheckId: id(), coverageCheckId: id(), jevReadingId: id(),
  };
}

/** Every string the input carries, replaced: two refusals compared modulo the ids they were asked about. */
function masked(message: string, input: unknown): string {
  const sent: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') sent.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(input);
  return sent.filter((s) => s.length >= 3).sort((x, y) => y.length - x.length).reduce((m, s) => m.split(s).join('<sent>'), message);
}

let t: TwoOrgs;
const savedOps = process.env.OPS_EMAILS;
beforeAll(async () => {
  process.env.OPS_EMAILS = ''; // nobody here is an operator, unless a test says so
  t = await buildTwoOrgs({ tag: 'iso-sweep' });
}, 120_000);
afterAll(async () => {
  if (savedOps === undefined) delete process.env.OPS_EMAILS; else process.env.OPS_EMAILS = savedOps;
  await t?.cleanup();
});

/** B's rows and the test queue before and after `call`: neither may change. */
async function leavesBAlone(label: string, call: () => Promise<unknown>): Promise<Settled> {
  const before = await snapshotOrg(t.b);
  const jobs = await queuedJobCount();
  const out = await settle(call());
  expect(await snapshotOrg(t.b), `${label} changed org B's rows`).toBe(before);
  expect(await queuedJobCount(), `${label} queued work`).toBe(jobs);
  return out;
}

describe('the classification table (spec §2.1)', () => {
  it('names every procedure, and only procedures that exist', () => {
    expect(Object.keys(PROCEDURE_CLASSES).sort()).toEqual(Object.keys(procedures).sort());
  });

  it('the stateless procedures are the two address checks', () => {
    expect(pathsOf('stateless').sort()).toEqual(['sources.checkListingPage', 'sources.reachability']);
  });
});

describe('no session (spec §2.1)', () => {
  const bare = createCaller({ db, session: null });
  // Every guard runs before input parsing, so `{}` reaches it for every path.
  it.each(Object.keys(PROCEDURE_CLASSES).filter((p) => PROCEDURE_CLASSES[p]!.class !== 'public'))('%s is UNAUTHORIZED', async (path) => {
    expect(codeOf(await leavesBAlone(path, () => at(bare, path)({})))).toBe('UNAUTHORIZED');
  });
});

describe("scoped: org B's ids from org A's caller (spec §2.1)", () => {
  it.each(pathsOf('scoped'))('%s is NOT_FOUND and leaves B alone', async (path) => {
    const e = entry(path, 'scoped');
    expect(codeOf(await leavesBAlone(path, () => at(t.a.owner.caller, path)(e.input(t.b))))).toBe('NOT_FOUND');
  });

  // NOT_FOUND must be the whole answer, not only its code: B's row refused reads exactly as a row that does not exist
  // (so a guessed id learns nothing), and the refusal names nothing of B the caller did not send itself.
  it.each(pathsOf('scoped'))("%s refuses B's row exactly as it refuses one that does not exist", async (path) => {
    const e = entry(path, 'scoped');
    const ghost = ghostOf(t.b);
    const toB = await leavesBAlone(path, () => at(t.a.owner.caller, path)(e.input(t.b)));
    const toNobody = await leavesBAlone(path, () => at(t.a.owner.caller, path)(e.input(ghost)));
    expect(toB.ok, path).toBe(false);
    expect(toNobody.ok, path).toBe(false);
    if (toB.ok || toNobody.ok) return;
    const sent = JSON.stringify(e.input(t.b));
    namesNothingOf(toB.error.message, needlesOf(t.b).filter((n) => !sent.includes(n)), `${path}'s refusal`);
    expect({ code: toB.error.code, message: masked(toB.error.message, e.input(t.b)) }, path)
      .toEqual({ code: toNobody.error.code, message: masked(toNobody.error.message, e.input(ghost)) });
  });

  // The inputs aim at real rows: B's own owner, with the same input, is not told NOT_FOUND (queries only — a mutation
  // would change B, and a `works` query would reach the worker).
  it.each(pathsOf('scoped').filter((p) => procedures[p]!._def.type === 'query' && !entry(p, 'scoped').works))(
    "%s: B's own owner reaches B's row with the same input",
    async (path) => {
      const out = await settle(at(t.b.owner.caller, path)(entry(path, 'scoped').input(t.b)));
      expect(out.ok || out.error.code !== 'NOT_FOUND', out.ok ? path : `${path}: ${out.error.message}`).toBe(true);
    },
  );
});

describe("org-wide: about the caller's own org (spec §2.1)", () => {
  it.each(pathsOf('org-wide'))('%s names nothing of B and leaves B alone', async (path) => {
    const e = entry(path, 'org-wide');
    const out = await leavesBAlone(path, () => at(t.a.owner.caller, path)(e.input?.(t.a)));
    namesNothingOf(out.ok ? out.value : out.error.message, needlesOf(t.b), path);
  });
});

describe("self: only the caller's own user and session (spec §2.1)", () => {
  it.each(pathsOf('self'))('%s answers, names nothing of B and leaves B alone', async (path) => {
    // A session of A's owner of its own: `auth.signOut` ends it and `orgs.create` moves it.
    const fresh = await signIn(t.a.owner.user.email);
    const out = await leavesBAlone(path, () => at(fresh.caller, path)(entry(path, 'self').input?.(t.a)));
    expect(out.ok, out.ok ? path : `${path}: ${out.error.message}`).toBe(true);
    namesNothingOf(out.ok ? out.value : null, needlesOf(t.b), path);
  });
});

describe("membership: B's org and people (spec §2.1)", () => {
  it.each(pathsOf('membership'))("%s refuses B's org id and user ids", async (path) => {
    const e = entry(path, 'membership');
    for (const input of e.inputs(t.b)) {
      expect(codeOf(await leavesBAlone(path, () => at(t.a.owner.caller, path)(input))), `${path} ${JSON.stringify(input)}`).toBe(e.refusal);
    }
  });
});

describe('ops: operators only (spec §2.1)', () => {
  it.each(pathsOf('ops'))('%s is FORBIDDEN to a customer', async (path) => {
    expect(codeOf(await leavesBAlone(path, () => at(t.a.owner.caller, path)(entry(path, 'ops').input?.(t.b))))).toBe('FORBIDDEN');
  });
});

describe('public: no session needed (spec §2.1)', () => {
  it.each(pathsOf('public'))('%s answers without a session and names nothing of B', async (path) => {
    const anon = createCaller({ db, session: null, setCookie: () => {}, clearCookie: () => {} });
    const out = await leavesBAlone(path, () => at(anon, path)(entry(path, 'public').input?.(t.a)));
    expect(out.ok, out.ok ? path : `${path}: ${out.error.message}`).toBe(true);
    namesNothingOf(out.ok ? out.value : null, needlesOf(t.b), path);
  });
});

describe("RF1: an own id paired with the other org's id", () => {
  it("RF1: a staff session in A asking for B's capture under A's website is NOT_FOUND", async () => {
    const op = await signedInCaller('iso-sweep-op');
    process.env.OPS_EMAILS = op.user.email;
    try {
      const inside = await enterAsStaff(op, t.a.org.id);
      const out = await leavesBAlone('jevReadings', () => inside.caller.sources.jevReadings({ sourceId: t.a.sourceId, captureIds: [t.a.captureId, t.b.captureId] }));
      expect(codeOf(out)).toBe('NOT_FOUND');
    } finally {
      process.env.OPS_EMAILS = '';
      await op.cleanup();
    }
  });

  it("RF1: A's backfill naming B's run items backfills nothing", async () => {
    const out = await leavesBAlone('backfill', () => t.a.owner.caller.crawl.backfill({ runId: t.a.runId, itemIds: t.b.itemIds }));
    expect(out.ok ? 'answered' : [out.error.code, out.error.message]).toEqual(['PRECONDITION_FAILED', 'nothing to backfill — no items are missing the requested fields']);
  });

  it("RF1: A's proof-page captures asked for at B's addresses answer nothing of B", async () => {
    const out = await leavesBAlone('proofPageCaptures', () => t.a.owner.caller.sources.proofPageCaptures({ sourceId: t.a.sourceId, urls: t.b.urls }));
    expect(out.ok).toBe(true);
    // The answer is keyed by the addresses asked for; nothing else of B may be in it.
    namesNothingOf(out.ok ? out.value : null, needlesOf(t.b).filter((n) => !t.b.urls.some((u) => u.includes(n))), 'proofPageCaptures');
  });
});
