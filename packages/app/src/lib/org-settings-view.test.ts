import { describe, it, expect } from 'vitest';
import { roleLabel, renameNote, roleOptions, roleNote, removeNote, deleteNote, deleteSummary, refusalMessage } from './org-settings-view';

describe('roles on the Settings page (spec §2)', () => {
  it('labels roles in sentence case', () => {
    expect(['owner', 'admin', 'member'].map((r) => roleLabel(r as never))).toEqual(['Owner', 'Admin', 'Member']);
  });

  it('owner and admin may rename; a member is told why not', () => {
    expect(renameNote('owner')).toBeNull();
    expect(renameNote('admin')).toBeNull();
    expect(renameNote('member')).toBe('Only an owner or admin can rename the organisation');
  });

  it('an admin cannot grant owner; a member can grant nothing', () => {
    expect(roleOptions('owner')).toEqual(['owner', 'admin', 'member']);
    expect(roleOptions('admin')).toEqual(['admin', 'member']);
    expect(roleOptions('member')).toEqual([]);
  });

  it("the owner's row is fixed, and a member changes nobody", () => {
    expect(roleNote({ caller: 'owner', target: 'admin' })).toBeNull();
    expect(roleNote({ caller: 'admin', target: 'member' })).toBeNull();
    expect(roleNote({ caller: 'owner', target: 'owner' })).toBe("The owner's role cannot be changed");
    expect(roleNote({ caller: 'member', target: 'member' })).toBe('Only an owner or admin can change roles');
  });

  it('nobody removes the owner or themselves; a member removes nobody', () => {
    expect(removeNote({ caller: 'owner', target: 'member', isSelf: false })).toBeNull();
    expect(removeNote({ caller: 'admin', target: 'admin', isSelf: false })).toBeNull();
    expect(removeNote({ caller: 'owner', target: 'owner', isSelf: true })).toBe('The owner cannot be removed');
    expect(removeNote({ caller: 'admin', target: 'admin', isSelf: true })).toBe('You cannot remove yourself');
    expect(removeNote({ caller: 'member', target: 'member', isSelf: false })).toBe('Only an owner or admin can remove members');
  });

  it('only the owner deletes, and never a personal organisation', () => {
    expect(deleteNote({ role: 'owner', personal: false })).toBeNull();
    expect(deleteNote({ role: 'owner', personal: true })).toBe('Your personal organisation cannot be deleted');
    expect(deleteNote({ role: 'admin', personal: false })).toBe('Only the owner can delete the organisation');
    expect(deleteNote({ role: 'member', personal: true })).toBe('Your personal organisation cannot be deleted');
  });

  it('says what a delete takes with it', () => {
    expect(deleteSummary(0)).toBe('It has no projects. Its members lose access.');
    expect(deleteSummary(1)).toBe('Its 1 project, with every website, run and row in it, is deleted. Its members lose access.');
    expect(deleteSummary(3)).toBe('Its 3 projects, with every website, run and row in them, are deleted. Its members lose access.');
  });

  it('says every project, unqualified, while the count is not known yet', () => {
    expect(deleteSummary(null)).toBe('Every project in it, with every website, run and row, is deleted. Its members lose access.');
  });
});

describe('refusalMessage', () => {
  it("shows the API's own words for one of orgs.ts's deliberate refusals", () => {
    expect(refusalMessage({ data: { code: 'FORBIDDEN' }, message: 'You cannot remove yourself' }, 'fallback')).toBe(
      'You cannot remove yourself',
    );
    expect(
      refusalMessage({ data: { code: 'PRECONDITION_FAILED' }, message: 'A personal organisation cannot be deleted' }, 'fallback'),
    ).toBe('A personal organisation cannot be deleted');
    expect(
      refusalMessage({ data: { code: 'NOT_FOUND' }, message: 'Not a member of this organisation' }, 'fallback'),
    ).toBe('Not a member of this organisation');
  });

  it('falls back on a code that is not one of the three refusals', () => {
    expect(
      refusalMessage({ data: { code: 'INTERNAL_SERVER_ERROR' }, message: 'This account has no personal organisation' }, 'fallback'),
    ).toBe('fallback');
  });

  it('falls back on an error that is not a tRPC-shaped object', () => {
    expect(refusalMessage('network error', 'fallback')).toBe('fallback');
    expect(refusalMessage(null, 'fallback')).toBe('fallback');
    expect(refusalMessage(undefined, 'fallback')).toBe('fallback');
  });

  it('falls back on a refusal that carries no message', () => {
    expect(refusalMessage({ data: { code: 'FORBIDDEN' } }, 'fallback')).toBe('fallback');
  });
});
