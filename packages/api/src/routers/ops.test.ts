import { afterEach, describe, expect, it } from 'vitest';
import { captures, db, domainIntelligence, projects, runs, sourceVerifications, sources, users } from '@robot/db';
import { and, eq } from 'drizzle-orm';
import { fieldHash, readsOneSource, type CertifiedPath, type FieldVerification, type SchemaDefinitionField, type VerificationSet } from '@robot/scraper';
import { router, createCallerFactory, isOperatorEmail, opsProcedure } from '../trpc.js';
import { appRouter } from './index.js';
import { loadSession } from '../auth/session.js';
import { deleteOwnOrg } from '../test-helpers/identity.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { seedAttention } from '../test-helpers/seed-attention.js';

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

      const { rows } = await u1.caller.ops.websites();
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

  // Spec 2026-10-28 §3.5: the newest proof-page capture per page in the last 24 h says whether a website is turned away.
  it('flags a website turned away (retrying, gave up, gave up by the fallback), its automatic proxy, and whether a fallback is configured', async () => {
    const tag = Date.now();
    const op = await signIn(`ops-ws-turned-${tag}@example.com`);
    process.env.OPS_EMAILS = op.user.email;
    const savedFallback = process.env.FALLBACK_PROXY_URL;
    const make = (name: string) => createProjectWithSource(op.caller, { tag: `ops-ta-${name}-${tag}`, fields: [{ name: 'Title', type: 'text' }] });
    const sites = { retrying: await make('retry'), direct: await make('direct'), fallback: await make('fb'), old: await make('old'), healed: await make('healed'), kept: await make('kept') };
    const at = (minAgo: number) => new Date(Date.now() - minAgo * 60_000);
    const wall = { kind: 'refused', status: 403 };
    const waiting = (url: string, first: Date) => ({ kind: 'proof-page', status: 'waiting', url, startedAt: first.toISOString(), firstStartedAt: first.toISOString(), error: 'x', verdict: wall, retryAt: new Date(Date.now() + 60_000).toISOString(), attempt: 2, via: 'direct' });
    const gaveUp = (url: string, first: Date, via: 'direct' | 'fallback') => ({ kind: 'proof-page', status: 'failed', url, startedAt: first.toISOString(), error: 'x', verdict: wall, gaveUp: true, attempts: 4, firstStartedAt: first.toISOString(), via });
    const captured = (url: string) => ({ kind: 'proof-page', status: 'captured', url, startedAt: new Date().toISOString(), capturedAt: new Date().toISOString(), tiles: [], boxes: [], pageHeight: 0, capturedHeight: 0, contentHeight: 0 });
    const insert = (sourceId: string, url: string, metadata: object, createdAt: Date) => db.insert(captures).values({ sourceId, url, metadata, createdAt });
    try {
      const r = sites.retrying, d = sites.direct, f = sites.fallback, o = sites.old, h = sites.healed;
      // Retrying: page 1 is waiting; page 2 gave up earlier — any page still trying reads as retrying.
      await insert(r.sourceId, r.urls[0]!, waiting(r.urls[0]!, at(20)), at(5));
      await insert(r.sourceId, r.urls[1]!, gaveUp(r.urls[1]!, at(30), 'direct'), at(10));
      await insert(d.sourceId, d.urls[0]!, gaveUp(d.urls[0]!, at(40), 'direct'), at(3));
      await insert(f.sourceId, f.urls[0]!, gaveUp(f.urls[0]!, at(50), 'fallback'), at(3));
      // Older than a day: not flagged.
      await insert(o.sourceId, o.urls[0]!, gaveUp(o.urls[0]!, at(26 * 60), 'direct'), at(25 * 60));
      // Superseded: an older waiting row, then a newer captured one of the same page.
      await insert(h.sourceId, h.urls[0]!, waiting(h.urls[0]!, at(20)), at(10));
      await insert(h.sourceId, h.urls[0]!, captured(h.urls[0]!), at(2));
      const keptAt = new Date('2026-10-27T09:30:00Z');
      await db.update(sources).set({ fallbackProxyAt: keptAt }).where(eq(sources.id, sites.kept.sourceId));

      delete process.env.FALLBACK_PROXY_URL;
      const answer = await op.caller.ops.websites();
      expect(answer.fallbackConfigured).toBe(false);
      const by = new Map(answer.rows.map((x) => [x.sourceId, x]));
      expect(by.get(r.sourceId)!.turnedAway).toMatchObject({ gaveUp: false, viaFallback: false });
      // Since the first try of the earliest page turned away.
      expect(Math.abs(Date.parse(by.get(r.sourceId)!.turnedAway!.since) - at(30).getTime())).toBeLessThan(5_000);
      expect(by.get(d.sourceId)!.turnedAway).toMatchObject({ gaveUp: true, viaFallback: false });
      expect(by.get(f.sourceId)!.turnedAway).toMatchObject({ gaveUp: true, viaFallback: true });
      expect(by.get(o.sourceId)!.turnedAway).toBeNull();
      expect(by.get(h.sourceId)!.turnedAway).toBeNull();
      expect(by.get(sites.kept.sourceId)).toMatchObject({ turnedAway: null, fallbackProxyAt: keptAt.toISOString() });
      expect(by.get(r.sourceId)!.fallbackProxyAt).toBeNull();

      process.env.FALLBACK_PROXY_URL = 'http://fallback.invalid:8080';
      expect((await op.caller.ops.websites()).fallbackConfigured).toBe(true);
      process.env.FALLBACK_PROXY_URL = '   ';
      expect((await op.caller.ops.websites()).fallbackConfigured).toBe(false);
      process.env.FALLBACK_PROXY_URL = 'ftp://not-usable:21';
      expect((await op.caller.ops.websites()).fallbackConfigured).toBe(false);
    } finally {
      if (savedFallback === undefined) delete process.env.FALLBACK_PROXY_URL; else process.env.FALLBACK_PROXY_URL = savedFallback;
      for (const s of Object.values(sites)) await s.cleanup();
      await dropIdentity(op);
    }
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

  it("gets its fields' certified paths in try order, named with the contract's own field names, with real run stats, 0/0 for a path the domain store never recorded, and the response a certified API path reads (its container), never the domain store's lastUrl", async () => {
    const tag = Date.now();
    const op = await signIn(`ops-site-op-${tag}@example.com`);
    process.env.OPS_EMAILS = op.user.email;
    const host = `test-ops4-${tag}.example.com`;
    const urls = [`https://${host}/p/1`, `https://${host}/p/2`, `https://${host}/p/3`];
    try {
      const built = await createProjectWithSource(op.caller, {
        tag: `ops4-${tag}`,
        fields: [{ name: 'Price', type: 'money' }, { name: 'Name', type: 'text' }, { name: 'Sale', type: 'money' }],
        urls,
        expected: {
          Price: Object.fromEntries(urls.map((u) => [u, '9.99'])),
          Name: Object.fromEntries(urls.map((u) => [u, 'Widget'])),
          Sale: Object.fromEntries(urls.map((u) => [u, '7.99'])),
        },
      });

      const source = await db.query.sources.findFirst({ where: eq(sources.id, built.sourceId), columns: { schemaDefinition: true } });
      const fields = source!.schemaDefinition as SchemaDefinitionField[];
      const priceKey = built.keys.Price!;
      const nameKey = built.keys.Name!;
      const priceConcept = fields.find((f) => f.key === priceKey)!.concept;

      const pricePrimary: CertifiedPath = { source: 'api', path: 'product.price', transform: 'identity', container: `https://${host}/api/product` };
      const priceBackup: CertifiedPath = { source: 'json-ld', path: 'offers.price', transform: 'identity', provenOn: [urls[0]!, urls[2]!] };
      const namePath: CertifiedPath = { source: 'json-ld', path: 'name', transform: 'identity' };
      // Final review Minor 4: a result certified before 2026-10-20 — API paths with no container.
      const saleKey = built.keys.Sale!;
      const saleOld: CertifiedPath[] = [{ source: 'api', path: 'product.sale', transform: 'identity' }, { source: 'api', path: 'product.saleNumeral', transform: 'identity' }];
      await certifyPaths(built.sourceId, { [priceKey]: [pricePrimary, priceBackup], [nameKey]: [namePath], [saleKey]: saleOld });

      await db.insert(domainIntelligence).values({
        domain: host,
        pageType: 'detail',
        fieldPaths: {
          [priceConcept]: {
            paths: [{
              path: 'product.price', source: 'verified', origin: 'api', transform: 'identity',
              confidence: 1, hits: 5, misses: 1, lastValue: '9.99', lastUsedAt: new Date().toISOString(),
              lastUrl: `https://${host}/p/1`,
            }],
            conflictCount: 0,
          },
        },
      });

      const result = await op.caller.ops.website({ sourceId: built.sourceId });

      expect(result.sourceId).toBe(built.sourceId);
      expect(result.org).toMatchObject({ id: op.org.id, name: op.org.name, slug: op.org.slug });
      expect(result.proofUrls).toEqual(urls);
      expect(result.verified).toEqual({ current: 3, total: 3 });

      expect(result.fields.map((f) => f.key)).toEqual([priceKey, nameKey, saleKey]);
      const priceField = result.fields.find((f) => f.key === priceKey)!;
      expect(priceField.name).toBe('Price');
      expect(priceField.state).toBe('current');
      expect(priceField.paths).toEqual([
        { source: 'api', path: 'product.price', container: `https://${host}/api/product`, uses: 6, hits: 5 },
        { source: 'json-ld', path: 'offers.price', provenOn: [urls[0], urls[2]], uses: 0, hits: 0 },
      ]);

      const nameField = result.fields.find((f) => f.key === nameKey)!;
      expect(nameField.name).toBe('Name');
      expect(nameField.state).toBe('current');
      expect(nameField.paths).toEqual([{ source: 'json-ld', path: 'name', uses: 0, hits: 0 }]);

      // An old row's API paths carry no container, and the all-API field reads as one source (the app warns on it).
      const saleField = result.fields.find((f) => f.key === saleKey)!;
      expect(saleField.paths).toEqual([
        { source: 'api', path: 'product.sale', uses: 0, hits: 0 },
        { source: 'api', path: 'product.saleNumeral', uses: 0, hits: 0 },
      ]);
      expect(readsOneSource(saleField.paths)).toBe(true);
      expect(readsOneSource(priceField.paths)).toBe(false);

      await db.delete(domainIntelligence).where(and(eq(domainIntelligence.domain, host), eq(domainIntelligence.pageType, 'detail')));
      await built.cleanup();
    } finally {
      await dropIdentity(op);
    }
  });

  it("shows a field's default and marks a default-only field (spec 2026-10-13 §7)", async () => {
    const tag = Date.now();
    const op = await signIn(`ops-site-op-default-${tag}@example.com`);
    process.env.OPS_EMAILS = op.user.email;
    const urls = [`https://test-ops4-default-${tag}.example.com/p/1`, `https://test-ops4-default-${tag}.example.com/p/2`, `https://test-ops4-default-${tag}.example.com/p/3`];
    try {
      const built = await createProjectWithSource(op.caller, {
        tag: `ops4-default-${tag}`,
        fields: [{ name: 'Price', type: 'money' }, { name: 'Name', type: 'text' }],
        urls,
        expected: {
          Price: Object.fromEntries(urls.map((u) => [u, '9.99'])),
          Name: Object.fromEntries(urls.map((u) => [u, 'Widget'])),
        },
      });
      const priceKey = built.keys.Price!;

      // Set the default on the source's own verification set, then certify Price by default only.
      const src = await db.query.sources.findFirst({ where: eq(sources.id, built.sourceId), columns: { verificationSet: true, schemaDefinition: true } });
      const set = { ...(src!.verificationSet as VerificationSet), defaults: { [priceKey]: '9.99' } };
      await db.update(sources).set({ verificationSet: set }).where(eq(sources.id, built.sourceId));
      const priceField = (src!.schemaDefinition as SchemaDefinitionField[]).find((f) => f.key === priceKey)!;
      const cells = Object.fromEntries(set.urls.map((u) => [u, { status: 'pass', found: '' }]));
      await db.insert(sourceVerifications).values({ sourceId: built.sourceId, definitionHash: 'x', completedAt: new Date(), allPassed: true,
        results: { [priceKey]: { key: priceKey, cells, certified: [], weakEvidence: false, aiCalled: false, incomplete: false, fieldHash: fieldHash(priceField, set), defaultOnly: true } } });
      const result = await op.caller.ops.website({ sourceId: built.sourceId });
      const price = result.fields.find((f) => f.key === priceKey)!;
      expect(price).toMatchObject({ state: 'current', paths: [], defaultValue: '9.99', defaultOnly: true });
      expect(result.fields.find((f) => f.key !== priceKey)).not.toHaveProperty('defaultValue');

      await built.cleanup();
    } finally {
      await dropIdentity(op);
    }
  });

  it("carries Jev's agreement per field from the verification's verify_agreement, and none for a field never asked (spec 2026-10-16 §8)", async () => {
    const tag = Date.now();
    const op = await signIn(`ops-site-op-jev-${tag}@example.com`);
    process.env.OPS_EMAILS = op.user.email;
    const urls = [1, 2, 3, 4, 5, 6].map((i) => `https://test-ops4-jev-${tag}.example.com/p/${i}`);
    try {
      const built = await createProjectWithSource(op.caller, { tag: `ops4-jev-${tag}`, fields: [{ name: 'Price', type: 'money' }, { name: 'Name', type: 'text' }], urls,
        expected: { Price: Object.fromEntries(urls.map((u) => [u, '9.99'])), Name: Object.fromEntries(urls.map((u) => [u, 'Widget'])) } });
      const priceKey = built.keys.Price!;
      await certifyPaths(built.sourceId, {});
      const cell = (agree: boolean) => ({ pick: 'c1', value: '9.99', p: 0.95, expected: agree ? '9.99' : '8.99', agree });
      const pages = Object.fromEntries(urls.map((u, i) => [u, { readingId: `r${i}`, fields: { [priceKey]: cell(i !== 3) } }]));
      await db.update(sourceVerifications).set({ verifyAgreement: { asked: 6, agreed: 5, pages } }).where(eq(sourceVerifications.sourceId, built.sourceId));
      const result = await op.caller.ops.website({ sourceId: built.sourceId });
      expect(result.fields.find((f) => f.key === priceKey)!.jevAgreement).toEqual({ agreed: 5, asked: 6 });
      expect(result.fields.find((f) => f.key !== priceKey)).not.toHaveProperty('jevAgreement');
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

  it("marks a held field 'held' with the hold's paths and date, counts it on the overview, and lists the automatic updates (spec 2026-10-21 §6)", async () => {
    const tag = Date.now();
    const op = await signIn(`ops-site-held-${tag}@example.com`);
    process.env.OPS_EMAILS = op.user.email;
    try {
      const host = `test-ops-held-${tag}.example.com`;
      const urls = [`https://${host}/p/1`, `https://${host}/p/2`, `https://${host}/p/3`];
      const built = await createProjectWithSource(op.caller, {
        tag: `ops-held-${tag}`,
        fields: [{ name: 'Price', type: 'money' }, { name: 'Title', type: 'text' }],
        urls,
        expected: { Price: Object.fromEntries(urls.map((u) => [u, '9.99'])), Title: Object.fromEntries(urls.map((u, i) => [u, `T${i}`])) },
      });
      const { heldSince } = await seedAttention(built.sourceId, { heldKey: built.keys.Title!, refreshedKey: built.keys.Price! });

      const site = await op.caller.ops.website({ sourceId: built.sourceId });
      const title = site.fields.find((f) => f.key === built.keys.Title)!;
      expect(title.state).toBe('held');
      expect(title.heldSince).toBe(heldSince.toISOString());
      expect(title.paths.map((p) => p.path)).toEqual(['name']); // the hold's path (seedAttention certifies `json-ld name`)
      expect(site.refreshes).toEqual([expect.objectContaining({ key: built.keys.Price, name: 'Price' })]);

      const row = (await op.caller.ops.websites()).rows.find((r) => r.sourceId === built.sourceId)!;
      expect(row.held).toBe(1);

      await built.cleanup();
    } finally {
      await dropIdentity(op);
    }
  });
});
