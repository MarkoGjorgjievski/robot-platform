// Who gets what (spec 2026-10-24 email §3.1, §7): owners and admins, by their preference; account messages always.
import { describe, it, expect } from 'vitest';
import { lookoutsOf, type MemberRow } from './recipients.js';

const row = (userId: string, role: string, emailAttention = true, emailFailedRuns = true): MemberRow =>
  ({ userId, email: `${userId}@example.com`, role, emailAttention, emailFailedRuns });
const ROWS = [row('owner', 'owner'), row('admin', 'admin'), row('quiet', 'admin', false, false), row('member', 'member'), row('runs-only', 'admin', false, true)];

describe('lookoutsOf', () => {
  it('website emails: owners and admins who keep that kind on; members never', () => {
    expect(lookoutsOf(ROWS, 'attention').map((r) => r.userId)).toEqual(['admin', 'owner']);
    expect(lookoutsOf(ROWS, 'failedRuns').map((r) => r.userId)).toEqual(['admin', 'owner', 'runs-only']);
  });
  it('account messages to owners and admins ignore preferences, and can leave one person out', () => {
    expect(lookoutsOf(ROWS, null).map((r) => r.userId)).toEqual(['admin', 'owner', 'quiet', 'runs-only']);
    expect(lookoutsOf(ROWS, null, 'admin').map((r) => r.userId)).toEqual(['owner', 'quiet', 'runs-only']);
  });
  it('hands out addresses only', () => {
    expect(lookoutsOf([row('owner', 'owner')], 'attention')).toEqual([{ userId: 'owner', email: 'owner@example.com' }]);
  });
});
