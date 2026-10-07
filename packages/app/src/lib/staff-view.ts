// Staff access copy (spec 2026-10-07 §2.2-2.3). Exact strings; the tests pin them.
import { relativeTime } from './projects-view';

export const STAFF_BLOCKED = 'Not available while working as staff';

/** `@robot/api`'s `STAFF_SESSION_ENDED_MESSAGE`: a mutation refused because the staff session ran past 8 hours. */
export const STAFF_SESSION_ENDED = 'Your staff session ended';

/**
 * Was this mutation refused because the staff session ended? The app then
 * reloads the router once (`Providers`' MutationCache), so `_app`'s gate sends
 * the operator to ops and `StaffExpiryNotice` says so and leaves.
 */
export function isStaffSessionEnded(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { message?: unknown }).message === STAFF_SESSION_ENDED;
}

export const bannerText =(customer: string) => `Working as Robot staff in ${customer}`;

export const confirmCopy = (website: string, customer: string) => ({
  title: `Work on ${website} as staff?`,
  body: `You'll act inside ${customer}'s organisation. Deleting things and managing the organisation are blocked. Everything you change is recorded and shown to ${customer}.`,
});

export const expiryToast = (customer: string) => `Your staff session in ${customer} ended after 8 hours.`;

/**
 * `_app`'s ops gate. An expired staff session lands in ops (where the expiry
 * toast fires and the session is left). An operator with no memberships of
 * their own has no customer screen to see — unless they are working as staff
 * inside a customer's org, which is exactly what lets them. A route already
 * inside ops mode is never bounced.
 */
export function mustGoToOps(
  s: { isOperator: boolean; orgCount: number; staff: boolean; staffExpired: boolean },
  inOps: boolean,
): boolean {
  if (inOps) return false;
  if (s.staffExpired) return true;
  return s.isOperator && s.orgCount === 0 && !s.staff;
}

/** The reason a control is disabled: staff mode first, then whatever the role allows. */
export function staffBlockedNote(staff: boolean, roleNote: string | null): string | null {
  return staff ? STAFF_BLOCKED : roleNote;
}

// ─── Staff activity (spec 2026-10-07 §2.4) ─────────────────────────────────

/**
 * Mirrors `@robot/api`'s `StaffEntry` (packages/api/src/auth/staff-activity.ts)
 * — the app never imports `@robot/api`'s router types directly, same reason
 * `lib/ops-view.ts` re-declares its own shapes file by file. `at` arrives as
 * a `Date` through superjson.
 */
export type StaffEntryView = {
  id: string;
  at: Date;
  actor: { name: string | null; email: string };
  org: { id: string; name: string };
  project: { id: string; name: string } | null;
  website: { id: string; name: string } | null;
  summary: string;
  run: { id: string; costUsd: number } | null;
};

/**
 * One row of the staff activity table (Global Constraints): `who` is the
 * name or, when the account is gone, the email (`whoDetail` is always the
 * email, for the line shown beneath it); `website` is "—" with no website;
 * `cost` is "$1.24" only when the linked run actually spent something, else
 * `null` — never shown for a free mutation or for no run at all.
 */
export function formatStaffEntry(e: StaffEntryView, now: Date = new Date()) {
  return {
    when: relativeTime(new Date(e.at), now),
    who: e.actor.name ?? e.actor.email,
    whoDetail: e.actor.email,
    website: e.website?.name ?? '—',
    sentence: e.summary,
    cost: e.run && e.run.costUsd > 0 ? `$${e.run.costUsd.toFixed(2)}` : null,
  };
}

/** One row of `ops.staffActivityFilters`'s `staff` list. */
export type StaffFilterOption = { userId: string | null; email: string; name: string | null };

/**
 * The ops "Staff" filter's options: the list can name the same email twice
 * — a reused address, once for the account that used to own it (now
 * `userId: null`, the FK's `on delete set null`) and once for whoever owns
 * it now — so the dropdown must show it once. Keeps whichever entry still
 * has a `userId` to filter by; if neither does, keeps the first.
 */
export function dedupeStaffByEmail(staff: readonly StaffFilterOption[]): StaffFilterOption[] {
  const byEmail = new Map<string, StaffFilterOption>();
  for (const s of staff) {
    const existing = byEmail.get(s.email);
    if (!existing || (!existing.userId && s.userId)) byEmail.set(s.email, s);
  }
  return [...byEmail.values()];
}
