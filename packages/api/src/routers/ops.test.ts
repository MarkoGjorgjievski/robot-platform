import { afterEach, describe, expect, it } from 'vitest';
import { db, domainIntelligence, projects, runs, sourceVerifications, sources, users } from '@robot/db';
import { and, eq } from 'drizzle-orm';
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

describe('ops.website', () => {
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

  /** Certifies each field in `pathsByKey` with its own ranked certified paths
   * (try order preserved), against the source's own verification set — same
   * hash-matching shape `certifyAllFields`/`seedDriftCheck` write directly,
   * without a real Verify. A field missing from `pathsByKey` still gets a
   * trivial passing certification so the whole source reads as current. */
  async function certifyPaths(sourceId: string, pathsByKey: Record<string, CertifiedPath[]>): Promise<void> {
    const source = await db.query.sources.findFirst({ where: eq(sources.id, sourceId), columns: { schemaDefinition: true, verificationSet: true } });
    const fields = (source!.schemaDefinition ?? []) as SchemaDefinitionField[];
    const set = (source!.verificationSet ?? { urls: [], expected: {} }) as VerificationSet;
    const results: Record<string, FieldVerification> = {};
    for (const field of fields) {
      const certified = pathsByKey[field.key] ?? [{ source: 'json-ld' as const, path: 'x', transform: 'identity' as const }];
      const cells = Object.fromEntries(set.urls.map((u) => [u, { status: 'pass' as const, found: 'x', path: certified[0]! }]));
      results[field.key] = { key: field.key, cells, certified, weakEvidence: false, aiCalled: false, incomplete: false, fieldHash: fieldHash(field, set) };
    }
    await db.insert(sourceVerifications).values({ sourceId, definitionHash: 'x', completedAt: new Date(), allPassed: true, results });
  }

  it("gets its fields' certified paths in try order, named with the contract's own field names, with real run stats, 0/0 for a path the domain store never recorded, and no container even where the domain store has a lastUrl (final review I2: that's the product page, not the request)", async () => {
    const tag = Date.now();
    const op = await signIn(`ops-site-op-${tag}@example.com`);
    process.env.OPS_EMAILS = op.user.email;
    const host = `test-ops4-${tag}.example.com`;
    const urls = [`https://${host}/p/1`, `https://${host}/p/2`, `https://${host}/p/3`];
    try {
      const built = await createProjectWithSource(op.caller, {
        tag: `ops4-${tag}`,
        fields: [{ name: 'Price', type: 'money' }, { name: 'Name', type: 'text' }],
        urls,
        expected: {
          Price: Object.fromEntries(urls.map((u) => [u, '9.99'])),
          Name: Object.fromEntries(urls.map((u) => [u, 'Widget'])),
        },
      });

      const source = await db.query.sources.findFirst({ where: eq(sources.id, built.sourceId), columns: { schemaDefinition: true } });
      const fields = source!.schemaDefinition as SchemaDefinitionField[];
      const priceKey = built.keys.Price!;
      const nameKey = built.keys.Name!;
      const priceConcept = fields.find((f) => f.key === priceKey)!.concept;

      const pricePrimary: CertifiedPath = { source: 'api', path: 'product.price', transform: 'identity' };
      const priceBackup: CertifiedPath = { source: 'json-ld', path: 'offers.price', transform: 'identity', provenOn: [urls[0]!, urls[2]!] };
      const namePath: CertifiedPath = { source: 'json-ld', path: 'name', transform: 'identity' };
      await certifyPaths(built.sourceId, { [priceKey]: [pricePrimary, priceBackup], [nameKey]: [namePath] });

      await db.insert(domainIntelligence).values({
        domain: host,
        pageType: 'detail',
        fieldPaths: {
          [priceConcept]: {
            paths: [{
              path: 'product.price', source: 'verified', origin: 'api', transform: 'identity',
              confidence: 1, hits: 5, misses: 1, lastValue: '9.99', lastUsedAt: new Date().toISOString(),
              lastUrl: `https://${host}/api/product`,
            }],
            conflictCount: 0,
          },
        },
      });

      const result = await op.caller.ops.website({ sourceId: built.sourceId });

      expect(result.sourceId).toBe(built.sourceId);
      expect(result.org).toMatchObject({ id: op.org.id, name: op.org.name, slug: op.org.slug });
      expect(result.proofUrls).toEqual(urls);
      expect(result.verified).toEqual({ current: 2, total: 2 });

      expect(result.fields.map((f) => f.key)).toEqual([priceKey, nameKey]);
      const priceField = result.fields.find((f) => f.key === priceKey)!;
      expect(priceField.name).toBe('Price');
      expect(priceField.state).toBe('current');
      expect(priceField.paths).toEqual([
        { source: 'api', path: 'product.price', uses: 6, hits: 5 },
        { source: 'json-ld', path: 'offers.price', provenOn: [urls[0], urls[2]], uses: 0, hits: 0 },
      ]);

      const nameField = result.fields.find((f) => f.key === nameKey)!;
      expect(nameField.name).toBe('Name');
      expect(nameField.state).toBe('current');
      expect(nameField.paths).toEqual([{ source: 'json-ld', path: 'name', uses: 0, hits: 0 }]);

      await db.delete(domainIntelligence).where(and(eq(domainIntelligence.domain, host), eq(domainIntelligence.pageType, 'detail')));
      await built.cleanup();
    } finally {
      await dropIdentity(op);
    }
  });

  it("gives FORBIDDEN to a signed-in non-operator, and UNAUTHORIZED to a signed-out caller", async () => {
    const tag = Date.now();
    process.env.OPS_EMAILS = '';
    const plain = await signIn(`ops-site-plain-${tag}@example.com`);
    try {
      const built = await createProjectWithSource(plain.caller, { tag: `ops4-forbidden-${tag}`, fields: [{ name: 'Price', type: 'money' }] });
      await expect(plain.caller.ops.website({ sourceId: built.sourceId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(callerWith(null).caller.ops.website({ sourceId: built.sourceId })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      await built.cleanup();
    } finally {
      await dropIdentity(plain);
    }
  });

  it('gives NOT_FOUND for a source that is not a customer-schema website, and answers for a website in an org the operator does not belong to', async () => {
    const tag = Date.now();
    const op = await signIn(`ops-site-op2-${tag}@example.com`);
    const other = await signIn(`ops-site-other-${tag}@example.com`);
    process.env.OPS_EMAILS = op.user.email;
    try {
      await expect(op.caller.ops.website({ sourceId: '00000000-0000-0000-0000-000000000000' })).rejects.toMatchObject({ code: 'NOT_FOUND' });

      const built = await createProjectWithSource(other.caller, { tag: `ops4-othermember-${tag}`, fields: [{ name: 'Price', type: 'money' }] });
      const result = await op.caller.ops.website({ sourceId: built.sourceId });
      expect(result.org.id).toBe(other.org.id);
      await built.cleanup();
    } finally {
      await dropIdentity(op);
      await dropIdentity(other);
    }
  });

  it("shows a partially verified website's current field's paths and stats, reporting the unverified one as 'none' (reviewer fix round 1: no longer gated by the whole-site all-or-nothing cert)", async () => {
    const tag = Date.now();
    const op = await signIn(`ops-site-partial-${tag}@example.com`);
    process.env.OPS_EMAILS = op.user.email;
    try {
      const host = `test-ops4-partial-${tag}.example.com`;
      const urls = [`https://${host}/p/1`, `https://${host}/p/2`, `https://${host}/p/3`];
      const built = await createProjectWithSource(op.caller, {
        tag: `ops4-partial-${tag}`,
        fields: [{ name: 'Price', type: 'money' }, { name: 'Name', type: 'text' }],
        urls,
        expected: { Price: Object.fromEntries(urls.map((u) => [u, '9.99'])), Name: Object.fromEntries(urls.map((u) => [u, 'Widget'])) },
      });
      const source = await db.query.sources.findFirst({ where: eq(sources.id, built.sourceId), columns: { schemaDefinition: true, verificationSet: true } });
      const fields = source!.schemaDefinition as SchemaDefinitionField[];
      const set = source!.verificationSet as VerificationSet;
      const priceField = fields.find((f) => f.key === built.keys.Price)!;
      const certified: CertifiedPath = { source: 'json-ld', path: 'offers.price', transform: 'identity' };
      const cells = Object.fromEntries(set.urls.map((u) => [u, { status: 'pass' as const, found: 'x', path: certified }]));
      // Only Price gets a result row — Name has none, so it is neither current nor unchanged.
      await db.insert(sourceVerifications).values({
        sourceId: built.sourceId,
        definitionHash: 'x',
        completedAt: new Date(),
        allPassed: true,
        results: { [priceField.key]: { key: priceField.key, cells, certified: [certified], weakEvidence: false, aiCalled: false, incomplete: false, fieldHash: fieldHash(priceField, set) } },
      });
      // Domain-store stats for Price's own path — proves hostname now comes
      // from `verificationSet.urls[0]` directly, not the (null, on a partial
      // site) whole-site cert, so a current field's real stats still surface.
      await db.insert(domainIntelligence).values({
        domain: host,
        pageType: 'detail',
        fieldPaths: {
          [priceField.concept]: {
            paths: [{
              path: 'offers.price', source: 'verified', origin: 'json-ld', transform: 'identity',
              confidence: 1, hits: 3, misses: 0, lastValue: '9.99', lastUsedAt: new Date().toISOString(),
            }],
            conflictCount: 0,
          },
        },
      });

      const result = await op.caller.ops.website({ sourceId: built.sourceId });
      expect(result.verified).toEqual({ current: 1, total: 2 });

      const priceOut = result.fields.find((f) => f.key === priceField.key)!;
      expect(priceOut.state).toBe('current');
      expect(priceOut.paths).toEqual([{ source: 'json-ld', path: 'offers.price', uses: 3, hits: 3 }]);

      const nameOut = result.fields.find((f) => f.key !== priceField.key)!;
      expect(nameOut.state).toBe('none');
      expect(nameOut.paths).toEqual([]);

      await db.delete(domainIntelligence).where(and(eq(domainIntelligence.domain, host), eq(domainIntelligence.pageType, 'detail')));
      await built.cleanup();
    } finally {
      await dropIdentity(op);
    }
  });

  it("marks a field 'changed' when its latest result's hash no longer matches the field as it stands now, and still shows its stale paths", async () => {
    const tag = Date.now();
    const op = await signIn(`ops-site-changed-${tag}@example.com`);
    process.env.OPS_EMAILS = op.user.email;
    try {
      const host = `test-ops4-changed-${tag}.example.com`;
      const urls = [`https://${host}/p/1`, `https://${host}/p/2`, `https://${host}/p/3`];
      const built = await createProjectWithSource(op.caller, {
        tag: `ops4-changed-${tag}`,
        fields: [{ name: 'Price', type: 'money' }],
        urls,
        expected: { Price: Object.fromEntries(urls.map((u) => [u, '9.99'])) },
      });
      const source = await db.query.sources.findFirst({ where: eq(sources.id, built.sourceId), columns: { schemaDefinition: true, verificationSet: true } });
      const fields = source!.schemaDefinition as SchemaDefinitionField[];
      const priceField = fields.find((f) => f.key === built.keys.Price)!;
      const set = source!.verificationSet as VerificationSet;
      const stalePath: CertifiedPath = { source: 'xpath', path: "//span[@class='old-price']", transform: 'identity' };
      const cells = Object.fromEntries(set.urls.map((u) => [u, { status: 'pass' as const, found: 'x', path: stalePath }]));
      // A fieldHash that cannot match `fieldHash(priceField, set)` — the field
      // (or its proof pages/expected values) changed since this result ran.
      await db.insert(sourceVerifications).values({
        sourceId: built.sourceId,
        definitionHash: 'x',
        completedAt: new Date(),
        allPassed: true,
        results: { [priceField.key]: { key: priceField.key, cells, certified: [stalePath], weakEvidence: false, aiCalled: false, incomplete: false, fieldHash: 'stale-hash-does-not-match' } },
      });

      const result = await op.caller.ops.website({ sourceId: built.sourceId });
      expect(result.verified).toEqual({ current: 0, total: 1 });

      const priceOut = result.fields.find((f) => f.key === priceField.key)!;
      expect(priceOut.state).toBe('changed');
      expect(priceOut.paths).toEqual([{ source: 'xpath', path: "//span[@class='old-price']", uses: 0, hits: 0 }]);

      await built.cleanup();
    } finally {
      await dropIdentity(op);
    }
  });

  // Final review M6: 'changed' used to cover both a true hash mismatch and
  // "same hash, but the result failed" — this is the second case, which the
  // app labels "Didn't pass verification" rather than "Changed since
  // verified". Same fieldHash as `fieldHash(priceField, set)` (nothing about
  // the binding moved), but a failing cell, so it's unchanged yet not current.
  it("marks a field 'failed' when its latest result's hash still matches but it didn't pass, distinct from 'changed'", async () => {
    const tag = Date.now();
    const op = await signIn(`ops-site-failed-${tag}@example.com`);
    process.env.OPS_EMAILS = op.user.email;
    try {
      const host = `test-ops4-failed-${tag}.example.com`;
      const urls = [`https://${host}/p/1`, `https://${host}/p/2`, `https://${host}/p/3`];
      const built = await createProjectWithSource(op.caller, {
        tag: `ops4-failed-${tag}`,
        fields: [{ name: 'Price', type: 'money' }],
        urls,
        expected: { Price: Object.fromEntries(urls.map((u) => [u, '9.99'])) },
      });
      const source = await db.query.sources.findFirst({ where: eq(sources.id, built.sourceId), columns: { schemaDefinition: true, verificationSet: true } });
      const fields = source!.schemaDefinition as SchemaDefinitionField[];
      const priceField = fields.find((f) => f.key === built.keys.Price)!;
      const set = source!.verificationSet as VerificationSet;
      const certified: CertifiedPath = { source: 'json-ld', path: 'offers.price', transform: 'identity' };
      // Passes on the first two proof pages, fails on the third — not all
      // cells 'pass', so it's never in `currentKeys`, but the fieldHash below
      // is the real, current one, so it stays in `unchangedKeys`.
      const cells = Object.fromEntries(set.urls.map((u, i) => [u, { status: (i === 2 ? 'fail' : 'pass') satisfies 'fail' | 'pass', found: 'x', path: certified }]));
      await db.insert(sourceVerifications).values({
        sourceId: built.sourceId,
        definitionHash: 'x',
        completedAt: new Date(),
        allPassed: false,
        results: { [priceField.key]: { key: priceField.key, cells, certified: [certified], weakEvidence: false, aiCalled: false, incomplete: false, fieldHash: fieldHash(priceField, set) } },
      });

      const result = await op.caller.ops.website({ sourceId: built.sourceId });
      expect(result.verified).toEqual({ current: 0, total: 1 });

      const priceOut = result.fields.find((f) => f.key === priceField.key)!;
      expect(priceOut.state).toBe('failed');
      expect(priceOut.paths).toEqual([{ source: 'json-ld', path: 'offers.price', uses: 0, hits: 0 }]);

      await built.cleanup();
    } finally {
      await dropIdentity(op);
    }
  });
});
