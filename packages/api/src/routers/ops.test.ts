import { afterEach, describe, expect, it } from 'vitest';
import { db, projects, runs, sourceVerifications, sources, users } from '@robot/db';
import { eq } from 'drizzle-orm';
import { fieldHash, type CertifiedPath, type FieldVerification, type SchemaDefinitionField, type VerificationSet } from '@robot/scraper';
import { router, createCallerFactory, isOperatorEmail, opsProcedure } from '../trpc.js';
import { appRouter } from './index.js';
import { loadSession } from '../auth/session.js';
import { deleteOwnOrg } from '../test-helpers/identity.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';

function callerWith(session: Awaited<ReturnType<typeof loadSession>> = null) {
  const cookies: Record<string, string | null> = {};
  const caller = createCallerFactory(appRouter)({ db, session, setCookie: (n, v) => { cookies[n] = v; }, clearCookie: (n) => { cookies[n] = null; } });
  return { caller, cookies };
}

async function signIn(email: string) {
  const { caller, cookies } = callerWith();
  const r = await caller.auth.signIn({ email, password: 'x' });
  const session = (await loadSession(db, cookies['robot_session']!))!;
  // A caller bound to the fresh session — `ops.websites`' own tests sign in as
  // customers too (to seed their projects) and as the operator (to call it).
  return { ...r, session, caller: callerWith(session).caller };
}

/** A minimal router built on `opsProcedure`, to probe the guard on its own —
 * `ops.me` is public and only ever returns `{ isOperator: false }` for a
 * non-operator, so it cannot show what FORBIDDEN looks like. */
const probeRouter = router({
  probe: opsProcedure.query(() => ({ ok: true as const })),
});
function probeCallerWith(session: Awaited<ReturnType<typeof loadSession>>) {
  return createCallerFactory(probeRouter)({ db, session });
}

describe('isOperatorEmail', () => {
  const ORIGINAL = process.env.OPS_EMAILS;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.OPS_EMAILS;
    else process.env.OPS_EMAILS = ORIGINAL;
  });

  it('matches an allowlisted email case-insensitively and trimmed', () => {
    process.env.OPS_EMAILS = ' A@x.com ,b@y.com';
    expect(isOperatorEmail('a@x.com')).toBe(true);
    expect(isOperatorEmail('A@X.COM')).toBe(true);
    expect(isOperatorEmail('B@Y.COM')).toBe(true);
  });

  it('rejects an email not on the list', () => {
    process.env.OPS_EMAILS = ' A@x.com ,b@y.com';
    expect(isOperatorEmail('c@z.com')).toBe(false);
  });

  it('rejects when there is no email at all', () => {
    process.env.OPS_EMAILS = ' A@x.com ,b@y.com';
    expect(isOperatorEmail(null)).toBe(false);
    expect(isOperatorEmail(undefined)).toBe(false);
  });

  it('nobody is an operator when the allowlist is empty or unset', () => {
    process.env.OPS_EMAILS = '';
    expect(isOperatorEmail('a@x.com')).toBe(false);
    delete process.env.OPS_EMAILS;
    expect(isOperatorEmail('a@x.com')).toBe(false);
  });
});

describe('ops.me', () => {
  const ORIGINAL = process.env.OPS_EMAILS;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.OPS_EMAILS;
    else process.env.OPS_EMAILS = ORIGINAL;
  });

  it('is false for a signed-out visitor', async () => {
    const { caller } = callerWith(null);
    expect(await caller.ops.me()).toEqual({ isOperator: false });
  });

  it('is true for a signed-in operator, false for a signed-in non-operator', async () => {
    const tag = Date.now();
    const opEmail = `ops-op-${tag}@example.com`;
    const plainEmail = `ops-plain-${tag}@example.com`;
    process.env.OPS_EMAILS = opEmail;
    const op = await signIn(opEmail);
    const plain = await signIn(plainEmail);
    try {
      expect(await callerWith(op.session).caller.ops.me()).toEqual({ isOperator: true });
      expect(await callerWith(plain.session).caller.ops.me()).toEqual({ isOperator: false });
    } finally {
      for (const r of [op, plain]) {
        await deleteOwnOrg(r.org.id);
        await db.delete(users).where(eq(users.id, r.user.id));
      }
    }
  });
});

describe('opsProcedure', () => {
  const ORIGINAL = process.env.OPS_EMAILS;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.OPS_EMAILS;
    else process.env.OPS_EMAILS = ORIGINAL;
  });

  it('gives FORBIDDEN to a non-operator who owns an org (Review Focus 1)', async () => {
    const tag = Date.now();
    const email = `ops-owner-${tag}@example.com`;
    process.env.OPS_EMAILS = '';
    const owner = await signIn(email);
    try {
      expect(owner.org.role).toBe('owner');
      await expect(probeCallerWith(owner.session).probe()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    } finally {
      await deleteOwnOrg(owner.org.id);
      await db.delete(users).where(eq(users.id, owner.user.id));
    }
  });

  it('gives UNAUTHORIZED to a signed-out caller', async () => {
    await expect(probeCallerWith(null).probe()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('lets an operator through', async () => {
    const tag = Date.now();
    const email = `ops-allowed-${tag}@example.com`;
    process.env.OPS_EMAILS = email;
    const op = await signIn(email);
    try {
      expect(await probeCallerWith(op.session).probe()).toEqual({ ok: true });
    } finally {
      await deleteOwnOrg(op.org.id);
      await db.delete(users).where(eq(users.id, op.user.id));
    }
  });
});

describe('ops.websites', () => {
  const ORIGINAL = process.env.OPS_EMAILS;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.OPS_EMAILS;
    else process.env.OPS_EMAILS = ORIGINAL;
  });

  async function dropIdentity(r: { org: { id: string }; user: { id: string } }) {
    await db.delete(projects).where(eq(projects.orgId, r.org.id));
    await deleteOwnOrg(r.org.id);
    await db.delete(users).where(eq(users.id, r.user.id));
  }

  /** Fully certifies every one of the source's contract fields against its own
   * verification set — the same hash-matching shape `seedDriftCheck` and
   * `current-certification.test.ts` write directly, without a real Verify. */
  async function certifyAllFields(sourceId: string, costUsd = '0'): Promise<void> {
    const source = await db.query.sources.findFirst({ where: eq(sources.id, sourceId), columns: { schemaDefinition: true, verificationSet: true } });
    const fields = (source!.schemaDefinition ?? []) as SchemaDefinitionField[];
    const set = (source!.verificationSet ?? { urls: [], expected: {} }) as VerificationSet;
    const certified: CertifiedPath = { source: 'json-ld', path: 'offers.price', transform: 'identity' };
    const cells = Object.fromEntries(set.urls.map((u) => [u, { status: 'pass' as const, found: 'x', path: certified }]));
    const results: Record<string, FieldVerification> = {};
    for (const field of fields) {
      results[field.key] = { key: field.key, cells, certified: [certified], weakEvidence: false, aiCalled: false, incomplete: false, fieldHash: fieldHash(field, set) };
    }
    await db.insert(sourceVerifications).values({ sourceId, definitionHash: 'x', completedAt: new Date(), allPassed: true, results, costUsd });
  }

  it('lists every customer website across orgs, problems first, ignoring the operator\'s own memberships (Review Focus 2)', async () => {
    const tag = Date.now();
    const u1 = await signIn(`ops-ws-1-${tag}@example.com`);
    const u2 = await signIn(`ops-ws-2-${tag}@example.com`);
    // The operator belongs only to u1's org — ops must still show u2's.
    process.env.OPS_EMAILS = u1.user.email;

    try {
      const drifting = await createProjectWithSource(u1.caller, {
        tag: `ops3-drift-${tag}`,
        fields: [{ name: 'Price', type: 'money' }, { name: 'Name', type: 'text' }],
      });
      await db.update(sources).set({ driftedFields: [drifting.keys.Price] }).where(eq(sources.id, drifting.sourceId));

      const failed = await createProjectWithSource(u2.caller, {
        tag: `ops3-failed-${tag}`,
        fields: [{ name: 'Price', type: 'money' }, { name: 'Name', type: 'text' }],
      });
      await db.insert(runs).values({ sourceId: failed.sourceId, status: 'failed', createdAt: new Date() });

      const unverified = await createProjectWithSource(u2.caller, {
        tag: `ops3-unverified-${tag}`,
        fields: [{ name: 'Price', type: 'money' }],
      });

      const healthyHost = `test-ops3-healthy-${tag}.example.com`;
      const healthyUrls = [`https://${healthyHost}/p/1`, `https://${healthyHost}/p/2`, `https://${healthyHost}/p/3`];
      const healthy = await createProjectWithSource(u1.caller, {
        tag: `ops3-healthy-${tag}`,
        fields: [{ name: 'Price', type: 'money' }, { name: 'Name', type: 'text' }],
        urls: healthyUrls,
        expected: {
          Price: Object.fromEntries(healthyUrls.map((u) => [u, '9.99'])),
          Name: Object.fromEntries(healthyUrls.map((u) => [u, 'Widget'])),
        },
      });
      await certifyAllFields(healthy.sourceId, '0.0200');
      await db.insert(runs).values({ sourceId: healthy.sourceId, status: 'completed', completedAt: new Date(), createdAt: new Date(), resultCount: 42, costUsd: '0.0100' });

      const rows = await u1.caller.ops.websites();
      const bySourceId = new Map(rows.map((r) => [r.sourceId, r]));

      const d = bySourceId.get(drifting.sourceId);
      expect(d).toMatchObject({
        org: { id: u1.org.id, name: u1.org.name, slug: u1.org.slug },
        project: { name: `Test ops3-drift-${tag}`, slug: drifting.projectSlug },
        website: { slug: drifting.sourceSlug, host: `test-ops3-drift-${tag}.example.com` },
        fields: 2,
        currentFields: 0,
        drifted: 1,
        lastRun: null,
      });
      expect(d!.driftedFieldNames).toEqual(['Price']);

      const f = bySourceId.get(failed.sourceId);
      expect(f).toMatchObject({ org: { id: u2.org.id }, currentFields: 0, drifted: 0 });
      expect(f!.lastRun).toMatchObject({ status: 'failed' });

      const uv = bySourceId.get(unverified.sourceId);
      expect(uv).toMatchObject({ org: { id: u2.org.id }, fields: 1, currentFields: 0, drifted: 0, lastRun: null, spentThisMonthUsd: 0 });

      const h = bySourceId.get(healthy.sourceId);
      expect(h).toMatchObject({ org: { id: u1.org.id }, fields: 2, currentFields: 2, drifted: 0 });
      expect(h!.lastRun).toMatchObject({ status: 'completed', rows: 42 });
      expect(h!.spentThisMonthUsd).toBeCloseTo(0.03, 4);

      // Review Focus 2: the operator is a member only of u1's org, yet both orgs show up.
      const orgIds = new Set(rows.map((r) => r.org.id));
      expect(orgIds.has(u1.org.id)).toBe(true);
      expect(orgIds.has(u2.org.id)).toBe(true);

      await Promise.all([drifting.cleanup(), failed.cleanup(), unverified.cleanup(), healthy.cleanup()]);
    } finally {
      await dropIdentity(u1);
      await dropIdentity(u2);
    }
  });

  it('gives FORBIDDEN to a signed-in non-operator', async () => {
    const tag = Date.now();
    process.env.OPS_EMAILS = '';
    const plain = await signIn(`ops-ws-plain-${tag}@example.com`);
    try {
      await expect(plain.caller.ops.websites()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    } finally {
      await dropIdentity(plain);
    }
  });

  it('gives UNAUTHORIZED to a signed-out caller', async () => {
    const { caller } = callerWith(null);
    await expect(caller.ops.websites()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
