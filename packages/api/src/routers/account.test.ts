// The signed-in person's email preferences (spec 2026-10-24 email §3.3–§3.4): both on by default, each saved on its
// own, only for themselves; for staff it is their own account.
import { describe, it, expect, afterAll } from 'vitest';
import { db } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';
import { signedInCaller } from '../test-helpers/identity.js';
import { STAFF_ACTIONS } from '../auth/staff-actions.js';
import { isRefusedAfterStaffExpiry } from '../auth/staff-guard.js';

const me = await signedInCaller('account-email');
const other = await signedInCaller('account-email-other');
afterAll(async () => { await me.cleanup(); await other.cleanup(); });

describe('account email preferences', () => {
  it('both on by default; each saves on its own, and only for the signed-in person', async () => {
    expect(await me.caller.account.emailPrefs()).toEqual({ attention: true, failedRuns: true });
    expect(await me.caller.account.updateEmailPrefs({ attention: false })).toEqual({ attention: false, failedRuns: true });
    expect(await me.caller.account.updateEmailPrefs({ failedRuns: false })).toEqual({ attention: false, failedRuns: false });
    expect(await me.caller.account.emailPrefs()).toEqual({ attention: false, failedRuns: false });
    expect(await other.caller.account.emailPrefs()).toEqual({ attention: true, failedRuns: true });
  });
  it('a signed-out caller is refused', async () => {
    const anon = createCallerFactory(appRouter)({ db, session: null });
    await expect(anon.account.emailPrefs()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(anon.account.updateEmailPrefs({ attention: false })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
  it('for staff it is their own account: never logged as a customer change, and allowed after the 8 hours', () => {
    expect(STAFF_ACTIONS['account.updateEmailPrefs']).toBeNull();
    expect(isRefusedAfterStaffExpiry('account.updateEmailPrefs', 'mutation')).toBe(false);
  });
});
