import { describe, it, expect } from 'vitest';
import { CUSTOMER_FIELD_TYPES } from '@robot/scraper';
import { FIELD_TYPES, TYPE_LABELS, fieldsView, sharedNote, addNote, deleteNote, nameRefusal, type ContractRow } from './fields-view';

const contract: ContractRow[] = [
  { key: 'price', name: 'Price', type: 'money', concept: 'price' },
  { key: 'title', name: 'Title', type: 'text', concept: 'product_name' },
];
const status = {
  price: { verified: 2, total: 3, websites: [{ sourceId: 'a', slug: 'a', name: 'Alpha', verified: true }, { sourceId: 'b', slug: 'b', name: 'Beta', verified: true }, { sourceId: 'c', slug: 'c', name: 'Gamma', verified: false }] },
  title: { verified: 0, total: 3, websites: [] },
};

describe('fields view', () => {
  it('the type list is the API\'s, with a label for each', () => {
    expect([...FIELD_TYPES]).toEqual([...CUSTOMER_FIELD_TYPES]);
    for (const t of FIELD_TYPES) expect(TYPE_LABELS[t]).toBeTruthy();
  });

  it('keeps contract order and says where each field is verified', () => {
    const v = fieldsView(contract, status, 3);
    expect(v.map((f) => f.name)).toEqual(['Price', 'Title']);
    expect(v[0]).toMatchObject({ typeLabel: 'Money', verifiedLabel: '2 of 3 websites', retypeLocked: true, verifiedOn: ['Alpha', 'Beta'] });
    expect(v[1]).toMatchObject({ typeLabel: 'Text', verifiedLabel: 'Not yet', retypeLocked: false, verifiedOn: [] });
  });

  it('with no websites the verified column is a dash, and before status loads nothing is locked', () => {
    expect(fieldsView(contract, undefined, 0)[0]).toMatchObject({ verifiedLabel: '—', retypeLocked: false });
  });

  it('counts one website in the singular', () => {
    const one = { price: { verified: 1, total: 1, websites: [{ sourceId: 'a', slug: 'a', name: 'Alpha', verified: true }] } };
    expect(fieldsView(contract, one, 1)[0]!.verifiedLabel).toBe('1 of 1 website');
  });

  it('notes', () => {
    expect(sharedNote(1)).toBeNull();
    expect(sharedNote(3)).toBe('Shared with 3 websites');
    expect(addNote(2)).toBe('This adds the field to 2 websites');
    expect(addNote(1)).toBeNull();
    const [price] = fieldsView(contract, status, 3);
    expect(deleteNote(price!, 3)).toBe('Removes it from 3 websites; 2 of them had verified it.');
    expect(deleteNote(fieldsView(contract, status, 1)[1]!, 1)).toBe('Removes it from 1 website.');
    expect(deleteNote(fieldsView(contract, undefined, 0)[1]!, 0)).toBe('Removes the field.');
  });

  // The two refusals a customer caused by typing, and can fix by typing: told in
  // their own words rather than with the screen's cause-neutral sentence, which
  // would send them round the same loop. Everything else is not theirs to fix.
  it('says the refusals a customer can fix, and nothing else', () => {
    const bad = (message: string) => ({ data: { code: 'BAD_REQUEST' }, message });
    expect(nameRefusal(bad('A field named "Price" already exists'), 'Price')).toBe('There is already a field called Price.');
    expect(nameRefusal(bad('"Detail url" is reserved'), 'Detail url')).toBe('Detail url is a name we use ourselves. Pick another.');
    expect(nameRefusal({ data: { code: 'PRECONDITION_FAILED' }, message: 'Alpha has verified this field' }, 'Price')).toBeNull();
    expect(nameRefusal(new Error('Failed to fetch'), 'Price')).toBeNull();
    expect(nameRefusal(undefined, 'Price')).toBeNull();
  });
});
