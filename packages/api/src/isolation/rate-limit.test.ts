// Rate limits (spec 2026-10-24 tenant isolation §2.4, §4.4): a fixed-window counter per process, by group. Every
// procedure test file runs with RATE_LIMITS=off (vitest.config.ts); this one turns it on, with its own limiter.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '@robot/db';
import { appRouter } from '../routers/index.js';
import { createCallerFactory, type SessionInfo } from '../trpc.js';
import { PROCEDURE_CLASSES } from './procedure-classes.js';
import {
  DEFAULT_LIMITS, HEAVY_PROCEDURES, NETWORK_PROCEDURES, RATE_LIMITED_MESSAGE, RateLimiter, groupOf, rateKeys, rateLimitsOn, useRateLimiter,
  type RateLimits,
} from './rate-limit.js';

const procedures = (appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def.procedures;
const createCaller = createCallerFactory(appRouter);

/** A session that needs no rows: its org and user ids name nothing, so every scoped call is NOT_FOUND. */
function sessionIn(orgId: string, o: { staff?: boolean } = {}): SessionInfo {
  return {
    token: randomUUID(),
    user: { id: randomUUID(), email: `rl-${randomUUID()}@example.com`, name: 'RL', avatarColour: '#3ddc84', theme: 'dark' },
    org: { id: orgId, slug: 'rl', name: 'RL', personal: true },
    role: 'owner',
    staff: o.staff ? { orgId, enteredAt: new Date() } : null,
    staffExpired: null,
  };
}
async function codeOf(p: Promise<unknown>): Promise<string> {
  try { await p; return 'answered'; } catch (e) { return (e as { code: string }).code; }
}

describe('the counter (spec §2.4)', () => {
  it('counts per key within a window, opens again when it ends, and prunes ended windows', () => {
    let now = 1_000_000;
    const l = new RateLimiter({ windowMs: 60_000, now: () => now });
    const k = (key: string, limit = 2) => [{ key, limit }];
    expect([l.take(k('a')), l.take(k('a')), l.take(k('a'))]).toEqual([true, true, false]);
    expect(l.take(k('b'))).toBe(true);
    now += 59_999;
    expect(l.take(k('a'))).toBe(false);
    now += 1;
    expect(l.take(k('a'))).toBe(true);
    now += 60_000;
    l.prune();
    expect(l.size).toBe(0);
  });

  it('is all or nothing across keys: a refused call counts against none of them', () => {
    const l = new RateLimiter();
    expect(l.take([{ key: 'x', limit: 1 }])).toBe(true);
    expect(l.take([{ key: 'y', limit: 1 }, { key: 'x', limit: 1 }])).toBe(false);
    expect(l.take([{ key: 'y', limit: 1 }])).toBe(true);
  });

  it('prunes by itself once a window has passed', () => {
    let now = 0;
    const l = new RateLimiter({ windowMs: 1000, now: () => now });
    for (let i = 0; i < 50; i++) l.take([{ key: `k${i}`, limit: 1 }]);
    expect(l.size).toBe(50);
    now = 1000;
    l.take([{ key: 'fresh', limit: 1 }]);
    expect(l.size).toBe(1);
  });

  it('holds at most maxKeys windows: a flood of distinct keys evicts the oldest, never grows the map', () => {
    let now = 0;
    const l = new RateLimiter({ windowMs: 60_000, maxKeys: 100, now: () => now });
    for (let i = 0; i < 1000; i++) { now = i; expect(l.take([{ key: `flood${i}`, limit: 1 }])).toBe(true); }
    expect(l.size).toBe(100);
    // The newest keys are the ones kept, still counted; the oldest were dropped.
    expect(l.take([{ key: 'flood999', limit: 1 }])).toBe(false);
    expect(l.take([{ key: 'flood0', limit: 1 }])).toBe(true);
    expect(l.size).toBe(100);
  });
});

describe('groups and keys (spec §2.4)', () => {
  it('the heavy and network lists are real procedures, and the stateless ones are network', () => {
    for (const p of [...HEAVY_PROCEDURES, ...NETWORK_PROCEDURES]) expect(procedures[p], p).toBeDefined();
    for (const [p, e] of Object.entries(PROCEDURE_CLASSES)) if (e.class === 'stateless') expect(groupOf(p), p).toBe('network');
    expect(groupOf('auth.signIn')).toBe('sign-in');
    expect(groupOf('sources.verify')).toBe('heavy');
    expect(groupOf('sources.variantList')).toBe('network');
    expect(groupOf('projects.list')).toBe('session');
  });

  it('every procedure the table says starts work is heavy or network, so a new one cannot land in the session group', () => {
    const starters = Object.entries(PROCEDURE_CLASSES).filter(([, e]) => e.class === 'scoped' && e.works).map(([p]) => p);
    expect(starters).toEqual(expect.arrayContaining(['sources.checkDrift', 'crawl.execute']));
    for (const p of starters) expect(['heavy', 'network'], p).toContain(groupOf(p));
  });

  it('each group keys and limits as the spec says', () => {
    const s = sessionIn('org-1');
    expect(rateKeys('auth.signIn', { session: null, clientIp: '1.2.3.4' }, { email: 'bob@example.com' })).toEqual([
      { key: 'sign-in:email:bob@example.com', limit: 10 }, { key: 'sign-in:ip:1.2.3.4', limit: 30 },
    ]);
    expect(rateKeys('sources.verify', { session: s }, undefined)).toEqual([{ key: 'heavy:org:org-1', limit: 30 }]);
    expect(rateKeys('sources.reachability', { session: s }, undefined)).toEqual([{ key: 'network:org:org-1', limit: 60 }]);
    expect(rateKeys('projects.list', { session: s }, undefined)).toEqual([{ key: `session:${s.token}`, limit: 600 }]);
    expect(rateKeys('datasets.catalogue', { session: null, clientIp: '1.2.3.4' }, undefined)).toEqual([{ key: 'session:ip:1.2.3.4', limit: 600 }]);
    expect(rateKeys('auth.signIn', { session: null }, 'not an object')).toEqual([{ key: 'sign-in:ip:unknown', limit: 30 }]);
  });

  it('RF3: case and spaces do not make a new email', () => {
    const [a] = rateKeys('auth.signIn', { session: null }, { email: ' Bob@Example.COM ' });
    const [b] = rateKeys('auth.signIn', { session: null }, { email: 'bob@example.com' });
    expect(a).toEqual(b);
  });

  it('RATE_LIMITS=off is the only way off', () => {
    expect(rateLimitsOn({})).toBe(true);
    expect(rateLimitsOn({ RATE_LIMITS: 'on' })).toBe(true);
    expect(rateLimitsOn({ RATE_LIMITS: ' OFF ' })).toBe(false);
  });
});

describe('the procedures, refused (spec §2.4)', () => {
  const saved = process.env.RATE_LIMITS;
  let previous: RateLimiter;
  const fresh = (limits: Partial<RateLimits> = {}) => useRateLimiter(new RateLimiter({ limits: { ...DEFAULT_LIMITS, ...limits } }));
  beforeAll(() => { process.env.RATE_LIMITS = 'on'; previous = fresh(); });
  beforeEach(() => { fresh(); });
  afterAll(() => {
    useRateLimiter(previous);
    if (saved === undefined) delete process.env.RATE_LIMITS; else process.env.RATE_LIMITS = saved;
  });

  // An empty password is refused by the input check (BAD_REQUEST) after the limiter counted it: nothing is written.
  it('signIn is refused on the 11th call for one email, whatever the address', async () => {
    const email = `rl-${randomUUID()}@example.com`;
    for (let i = 0; i < 10; i++) {
      const anon = createCaller({ db, session: null, clientIp: `10.0.0.${i}` });
      expect(await codeOf(anon.auth.signIn({ email, password: '' }))).toBe('BAD_REQUEST');
    }
    const eleventh = createCaller({ db, session: null, clientIp: '10.0.1.1' });
    await expect(eleventh.auth.signIn({ email: email.toUpperCase(), password: '' })).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS', message: RATE_LIMITED_MESSAGE });
    expect(await codeOf(eleventh.auth.signIn({ email: `other-${email}`, password: '' }))).toBe('BAD_REQUEST');
  });

  it('signIn is refused on the 31st call from one address, while another address is not', async () => {
    const anon = createCaller({ db, session: null, clientIp: '10.1.0.1' });
    for (let i = 0; i < 30; i++) expect(await codeOf(anon.auth.signIn({ email: `rl-${i}-${randomUUID()}@example.com`, password: '' }))).toBe('BAD_REQUEST');
    expect(await codeOf(anon.auth.signIn({ email: `rl-${randomUUID()}@example.com`, password: '' }))).toBe('TOO_MANY_REQUESTS');
    const other = createCaller({ db, session: null, clientIp: '10.1.0.2' });
    expect(await codeOf(other.auth.signIn({ email: `rl-${randomUUID()}@example.com`, password: '' }))).toBe('BAD_REQUEST');
  });

  it('a heavy procedure is refused on the 31st call for one org, while another org is unaffected', async () => {
    const orgX = randomUUID();
    const one = createCaller({ db, session: sessionIn(orgX) });
    const two = createCaller({ db, session: sessionIn(orgX) }); // another member of the same org: the same budget
    for (let i = 0; i < 30; i++) expect(await codeOf((i % 2 ? one : two).sources.verify({ sourceId: randomUUID() }))).toBe('NOT_FOUND');
    await expect(one.sources.verify({ sourceId: randomUUID() })).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS', message: RATE_LIMITED_MESSAGE });
    expect(await codeOf(two.crawl.plan({ sourceId: randomUUID(), probe: true }))).toBe('TOO_MANY_REQUESTS');
    expect(await codeOf(createCaller({ db, session: sessionIn(randomUUID()) }).sources.verify({ sourceId: randomUUID() }))).toBe('NOT_FOUND');
    // Other groups are not this one: the org's ordinary calls still answer.
    expect(await codeOf(one.sources.verificationStatus({ sourceId: randomUUID() }))).toBe('NOT_FOUND');
  });

  it('RF4: staff in an org and its customers count apart', async () => {
    fresh({ heavy: 2 });
    const org = randomUUID();
    const customer = createCaller({ db, session: sessionIn(org) });
    const staff = createCaller({ db, session: sessionIn(org, { staff: true }) });
    for (let i = 0; i < 2; i++) expect(await codeOf(customer.sources.verify({ sourceId: randomUUID() }))).toBe('NOT_FOUND');
    expect(await codeOf(customer.sources.verify({ sourceId: randomUUID() }))).toBe('TOO_MANY_REQUESTS');
    for (let i = 0; i < 2; i++) expect(await codeOf(staff.sources.verify({ sourceId: randomUUID() }))).toBe('NOT_FOUND');
    expect(await codeOf(staff.sources.verify({ sourceId: randomUUID() }))).toBe('TOO_MANY_REQUESTS');
  });

  it('everything else is per session', async () => {
    fresh({ session: 3 });
    const s = createCaller({ db, session: sessionIn(randomUUID()) });
    for (let i = 0; i < 3; i++) expect(await codeOf(s.auth.me())).toBe('answered');
    expect(await codeOf(s.auth.me())).toBe('TOO_MANY_REQUESTS');
    expect(await codeOf(createCaller({ db, session: sessionIn(randomUUID()) }).auth.me())).toBe('answered');
  });

  it('RATE_LIMITS=off lets every call through', async () => {
    fresh({ session: 1 });
    process.env.RATE_LIMITS = 'off';
    try {
      const s = createCaller({ db, session: sessionIn(randomUUID()) });
      for (let i = 0; i < 3; i++) expect(await codeOf(s.auth.me())).toBe('answered');
    } finally {
      process.env.RATE_LIMITS = 'on';
    }
  });
});
