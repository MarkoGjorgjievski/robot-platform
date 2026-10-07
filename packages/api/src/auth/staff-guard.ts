// What staff may not do inside a customer's organisation (spec 2026-10-07 §2.3).
// One list, checked by one middleware on every protected procedure; a path not
// listed is allowed. `staff-guard.test.ts` fails if a listed path stops existing.

export const STAFF_BLOCKED_MESSAGE = 'Not available while working as staff';

export const STAFF_DENY_LIST = [
  // The organisation itself
  'orgs.rename',
  'orgs.delete',
  'orgs.create',
  'orgs.members.setRole',
  'orgs.members.remove',
  'auth.switchOrg',
  // Deletions
  'projects.delete',
  'sources.delete',
  'datasets.deleteField',
  'datasets.deleteAxis',
] as const;

const blocked = new Set<string>(STAFF_DENY_LIST);

export function isStaffBlocked(path: string): boolean {
  return blocked.has(path);
}

// A staff session past its 8 hours (final review, 2026-10-07): `loadSession` already
// puts it back in the operator's own org, so a page left open in the customer's org
// would otherwise change the operator's own data. Every mutation is refused except
// leaving/entering and the operator's own account; the app reloads on this message.
export const STAFF_SESSION_ENDED_MESSAGE = 'Your staff session ended';

const allowedAfterExpiry = new Set<string>(['ops.leaveOrg', 'ops.enterOrg', 'auth.signOut', 'auth.setTheme', 'auth.updateName']);

export function isRefusedAfterStaffExpiry(path: string, type: string): boolean {
  return type === 'mutation' && !allowedAfterExpiry.has(path);
}
