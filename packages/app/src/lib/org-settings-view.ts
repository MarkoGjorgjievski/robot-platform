/**
 * What a role may do on the organisation's Settings page, and — because every
 * disabled control owes the reader a reason — the sentence for when it may
 * not. The rules are spec 2026-09-21 §2's, and the API enforces the same ones
 * (orgs.ts); these exist so the reason is on screen before the click, not in
 * an error after it.
 */

export type Role = 'owner' | 'admin' | 'member';

const LABELS: Record<Role, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' };

export function roleLabel(role: Role): string {
  return LABELS[role];
}

const manages = (role: Role) => role === 'owner' || role === 'admin';

export function renameNote(role: Role): string | null {
  return manages(role) ? null : 'Only an owner or admin can rename the organisation';
}

/** What the caller may set someone to. Granting owner is the owner's alone (orgs.members.setRole). */
export function roleOptions(caller: Role): Role[] {
  if (caller === 'owner') return ['owner', 'admin', 'member'];
  if (caller === 'admin') return ['admin', 'member'];
  return [];
}

export function roleNote({ caller, target }: { caller: Role; target: Role }): string | null {
  if (target === 'owner') return "The owner's role cannot be changed";
  if (!manages(caller)) return 'Only an owner or admin can change roles';
  return null;
}

export function removeNote({ caller, target, isSelf }: { caller: Role; target: Role; isSelf: boolean }): string | null {
  if (target === 'owner') return 'The owner cannot be removed';
  if (!manages(caller)) return 'Only an owner or admin can remove members';
  if (isSelf) return 'You cannot remove yourself';
  return null;
}

export function deleteNote({ role, personal }: { role: Role; personal: boolean }): string | null {
  if (personal) return 'Your personal organisation cannot be deleted';
  if (role !== 'owner') return 'Only the owner can delete the organisation';
  return null;
}

export function deleteSummary(projectCount: number): string {
  if (projectCount === 0) return 'It has no projects. Its members lose access.';
  if (projectCount === 1) return 'Its 1 project, with every website, run and row in it, is deleted. Its members lose access.';
  return `Its ${projectCount} projects, with every website, run and row in them, are deleted. Its members lose access.`;
}

/** The codes `orgs.ts` throws on purpose — a refusal, not a failure. */
const REFUSAL_CODES = new Set(['FORBIDDEN', 'PRECONDITION_FAILED', 'NOT_FOUND']);

/**
 * What to show for a failed mutation on this page (same grammar as
 * `delete-website-dialog.tsx`'s `deleteNote`-driven catch): the API's own
 * words for one of its deliberate refusals — a role race, a personal
 * organisation, a member already gone — and the component's generic sentence
 * for everything else, so an `INTERNAL_SERVER_ERROR` or a network failure's
 * raw text never reaches the customer.
 */
export function refusalMessage(e: unknown, fallback: string): string {
  if (typeof e !== 'object' || e === null) return fallback;
  const err = e as { data?: { code?: string }; message?: string };
  if (err.data?.code && REFUSAL_CODES.has(err.data.code) && err.message) return err.message;
  return fallback;
}
