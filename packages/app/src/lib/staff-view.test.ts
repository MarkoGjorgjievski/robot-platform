import { describe, expect, it } from 'vitest';
import { STAFF_BLOCKED, STAFF_SESSION_ENDED, bannerText, confirmCopy, dedupeStaffByEmail, expiryToast, formatStaffEntry, isStaffSessionEnded, mustGoToOps, staffBlockedNote } from './staff-view';

describe('staff-view (spec 2026-10-07 §2.2-2.3)', () => {
  it('copy is exact', () => {
    expect(bannerText('Acme')).toBe('Working as Robot staff in Acme');
    expect(confirmCopy('Nike', 'Acme')).toEqual({
      title: 'Work on Nike as staff?',
      body: "You'll act inside Acme's organisation. Deleting things and managing the organisation are blocked. Everything you change is recorded and shown to Acme.",
    });
    expect(expiryToast('Acme')).toBe('Your staff session in Acme ended after 8 hours.');
    expect(STAFF_BLOCKED).toBe('Not available while working as staff');
  });

  it('sends to ops: expired staff sessions, and operators with no org unless they are working as staff', () => {
    const base = { isOperator: true, orgCount: 0, staff: false, staffExpired: false };
    // An operator with no memberships, working inside a customer org, stays there.
    expect(mustGoToOps({ ...base, staff: true }, false)).toBe(false);
    // ...but without staff mode has no customer screen to see.
    expect(mustGoToOps(base, false)).toBe(true);
    // An expired staff session always lands in ops, member of orgs or not.
    expect(mustGoToOps({ ...base, orgCount: 2, staffExpired: true }, false)).toBe(true);
    // Never bounce a route already inside ops mode.
    expect(mustGoToOps({ ...base, staffExpired: true }, true)).toBe(false);
    expect(mustGoToOps(base, true)).toBe(false);
    // A customer is never sent to ops.
    expect(mustGoToOps({ isOperator: false, orgCount: 1, staff: false, staffExpired: false }, false)).toBe(false);
  });

  it('staff mode wins over the role note', () => {
    expect(staffBlockedNote(true, 'Only owners can do that')).toBe(STAFF_BLOCKED);
    expect(staffBlockedNote(false, 'Only owners can do that')).toBe('Only owners can do that');
    expect(staffBlockedNote(false, null)).toBeNull();
  });

  it('formats an entry, with cost only when spent and the email when the name is gone', () => {
    const now = new Date('2026-10-07T12:00:00Z');
    const base = { id: '1', at: new Date('2026-10-07T11:00:00Z'), org: { id: 'o', name: 'Acme' }, project: null, website: { id: 's', name: 'Nike' }, summary: 'Ran an extraction on Nike' };
    const a = formatStaffEntry({ ...base, actor: { name: 'Sam', email: 'sam@robot.dev' }, run: { id: 'r', costUsd: 1.24 } }, now);
    expect(a).toMatchObject({ who: 'Sam', whoDetail: 'sam@robot.dev', website: 'Nike', sentence: 'Ran an extraction on Nike', cost: '$1.24' });
    const b = formatStaffEntry({ ...base, actor: { name: null, email: 'gone@robot.dev' }, run: { id: 'r', costUsd: 0 } }, now);
    expect(b).toMatchObject({ who: 'gone@robot.dev', cost: null });
    const c = formatStaffEntry({ ...base, website: null, actor: { name: 'Sam', email: 's@x' }, run: null }, now);
    expect(c.website).toBe('—');
  });

  it('dedupes the staff filter by email, preferring the entry that still has a userId', () => {
    const staff = [
      { userId: null, email: 'gone@robot.dev', name: 'Old Sam' },
      { userId: 'u2', email: 'gone@robot.dev', name: 'New Sam' },
      { userId: 'u3', email: 'ann@robot.dev', name: 'Ann' },
    ];
    const deduped = dedupeStaffByEmail(staff);
    expect(deduped).toHaveLength(2);
    expect(deduped.find((s) => s.email === 'gone@robot.dev')).toMatchObject({ userId: 'u2', name: 'New Sam' });
    expect(deduped.find((s) => s.email === 'ann@robot.dev')).toMatchObject({ userId: 'u3', name: 'Ann' });
  });
});

describe('isStaffSessionEnded (final review, 2026-10-07)', () => {
  it('matches only the api\'s "Your staff session ended" refusal', () => {
    expect(STAFF_SESSION_ENDED).toBe('Your staff session ended');
    expect(isStaffSessionEnded(new Error('Your staff session ended'))).toBe(true);
    expect(isStaffSessionEnded({ message: 'Your staff session ended' })).toBe(true);
    expect(isStaffSessionEnded(new Error('Not available while working as staff'))).toBe(false);
    expect(isStaffSessionEnded(new Error('Your staff session ended.'))).toBe(false);
    expect(isStaffSessionEnded(null)).toBe(false);
    expect(isStaffSessionEnded('Your staff session ended')).toBe(false);
  });
});
