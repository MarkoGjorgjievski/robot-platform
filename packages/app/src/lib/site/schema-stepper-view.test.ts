import { describe, it, expect } from 'vitest';
import { stepOf, stepStates, sharedNote, addNote } from './schema-stepper-view';

describe('stepOf', () => {
  it('defaults to fields on an empty contract and pages otherwise', () => {
    expect(stepOf({}, 0)).toBe('fields');
    expect(stepOf({}, 3)).toBe('pages');
  });
  it('honours a valid step in the URL, ignores an invalid one', () => {
    expect(stepOf({ step: 'fields' }, 3)).toBe('fields');
    expect(stepOf({ step: 'pages' }, 0)).toBe('fields'); // pages needs a field
    expect(stepOf({ step: 'mark' }, 3)).toBe('pages');
  });
});
describe('stepStates', () => {
  it('fields current, pages later while the contract is empty', () => {
    expect(stepStates('fields', 0)).toEqual(['current', 'later']);
  });
  it('fields current, pages done-ish (locked) when reopened with fields present', () => {
    expect(stepStates('fields', 2)).toEqual(['current', 'locked']);
  });
  it('fields done, pages current on the pages step', () => {
    expect(stepStates('pages', 2)).toEqual(['done', 'current']);
  });
});
describe('notes', () => {
  it('speak only for a shared contract', () => {
    expect(sharedNote(1)).toBeNull();
    expect(sharedNote(2)).toBe('shared with 2 websites');
    expect(addNote(1)).toBeNull();
    expect(addNote(3)).toBe('This adds the field to 3 websites');
  });
});
