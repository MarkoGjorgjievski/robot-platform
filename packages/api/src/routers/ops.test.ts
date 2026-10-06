import { afterEach, describe, expect, it } from 'vitest';
import { db, users } from '@robot/db';
import { eq } from 'drizzle-orm';
import { router, createCallerFactory, isOperatorEmail, opsProcedure } from '../trpc.js';
import { appRouter } from './index.js';
import { loadSession } from '../auth/session.js';
import { deleteOwnOrg } from '../test-helpers/identity.js';

function callerWith(session: Awaited<ReturnType<typeof loadSession>> = null) {
  const cookies: Record<string, string | null> = {};
  const caller = createCallerFactory(appRouter)({ db, session, setCookie: (n, v) => { cookies[n] = v; }, clearCookie: (n) => { cookies[n] = null; } });
  return { caller, cookies };
}

async function signIn(email: string) {
  const { caller, cookies } = callerWith();
  const r = await caller.auth.signIn({ email, password: 'x' });
  const session = (await loadSession(db, cookies['robot_session']!))!;
  return { ...r, session };
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
