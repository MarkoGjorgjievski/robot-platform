import { describe, expect, it } from 'vitest';
import { JEV_MISSING_FETCHES, jevDetailText, jevNote, jevPollMs, readsVariantList, type JevReadingLike } from './jev-view';
import { emptyBoard, type Board, type Field, type Suggestions } from './verification-model';

const price: Field = { key: 'price', name: 'Price', type: 'money', description: '', concept: 'price' };
const cards = [{ url: 'u1', title: '' }, { url: 'u2', title: '' }, { url: 'u3', title: '' }];
const board = (answers: Board['answers'] = {}): Board => ({ ...emptyBoard(), cards, answers });
const live = (v: string): Suggestions => ({ price: { u1: { captureId: 'k', value: v, boxes: [], origin: 'page-data' } } });
const done = (pick: string, p: number, extra: Partial<NonNullable<JevReadingLike['answers']>> = {}): JevReadingLike => ({
  status: 'done', answers: { fields: { price: { candidates: [{ id: 'c1', value: '374.25' }, { id: 'c2', value: '$499.00' }], pick, p } }, ...extra },
});

describe('jevNote', () => {
  it('says what Jev reads when it differs from the suggestion', () => {
    expect(jevNote(price, board(), live('499.00'), { u1: done('c1', 0.98) }, false)).toBe('Jev reads 374.25 as the Price on product 1');
  });
  it('silent when Jev agrees with the suggestion (by amount)', () => {
    expect(jevNote(price, board(), live('$374.25'), { u1: done('c1', 0.98) }, false)).toBeNull();
  });
  it('compares with the customer\'s answer when there is one', () => {
    expect(jevNote(price, board({ price: { u1: { value: '499.00', mark: null } } }), {}, { u1: done('c1', 0.9) }, false)).toBe('Jev reads 374.25 as the Price on product 1');
  });
  it('silent below p 0.6, on a none pick, and for a running or failed reading', () => {
    expect(jevNote(price, board(), live('499.00'), { u1: done('c1', 0.59) }, false)).toBeNull();
    expect(jevNote(price, board(), live('499.00'), { u1: done('none', 0.9) }, false)).toBeNull();
    expect(jevNote(price, board(), live('499.00'), { u1: { status: 'running', answers: null } }, false)).toBeNull();
    expect(jevNote(price, board(), live('499.00'), { u1: { status: 'failed', answers: null } }, false)).toBeNull();
  });
  it('a running reading renders nothing, a done one renders', () => {
    expect(jevNote(price, board(), live('499.00'), {}, false)).toBeNull();
    expect(jevNote(price, board(), live('499.00'), { u1: done('c1', 0.98) }, false)).not.toBeNull();
  });
  it('the variant note when the field reads a variant list and Jev differs from the [page] match', () => {
    const r = done('c1', 0.98, { variant: { entries: [{ id: 'e1', label: "2'x3'" }, { id: 'e2', label: "6'x9'" }], pick: 'e2', p: 0.95, pageMatch: 'e1' } });
    expect(jevNote(price, board(), live('$374.25'), { u1: r }, true)).toBe("Jev reads the selected variant as 6'x9' on product 1");
    expect(jevNote(price, board(), live('$374.25'), { u1: r }, false)).toBeNull();
  });
  it('one note per row: the lowest product that differs, the field note first', () => {
    const r = done('c1', 0.98, { variant: { entries: [{ id: 'e1', label: 'a' }, { id: 'e2', label: 'b' }], pick: 'e2', p: 0.95, pageMatch: 'e1' } });
    const l: Suggestions = { price: { u1: { captureId: 'k', value: '374.25', boxes: [], origin: 'page-data' }, u2: { captureId: 'k', value: '499.00', boxes: [], origin: 'page-data' } } };
    expect(jevNote(price, board(), l, { u1: r, u2: done('c1', 0.98) }, true)).toBe('Jev reads 374.25 as the Price on product 2');
  });
});

describe('jevDetailText', () => {
  it('the pick and its probability, none, or not read', () => {
    expect(jevDetailText(done('c1', 0.98), 'price')).toBe('Jev: 374.25 (0.98)');
    expect(jevDetailText(done('none', 0.71), 'price')).toBe('Jev: none of these (0.71)');
    expect(jevDetailText(undefined, 'price')).toBe('Jev: not read');
    expect(jevDetailText(done('c1', 0.98), 'title')).toBe('Jev: not read');
  });
});

describe('readsVariantList', () => {
  it('[page] or a fixed index on a variant list', () => {
    expect(readsVariantList('hasVariant[page].offers.price')).toBe(true);
    expect(readsVariantList('offers[0].price')).toBe(true);
    expect(readsVariantList('@graph[1].name')).toBe(false);
    expect(readsVariantList(undefined)).toBe(false);
  });
});

describe('jevPollMs', () => {
  const run: JevReadingLike = { status: 'running', answers: null };
  it('polls while a reading runs and stops once every one is done or failed', () => {
    expect(jevPollMs({ k1: run, k2: done('c1', 0.9) }, ['k1', 'k2'], { errored: false, fetches: 5 })).toBe(3000);
    expect(jevPollMs({ k1: done('c1', 0.9), k2: { status: 'failed', answers: null } }, ['k1', 'k2'], { errored: false, fetches: 1 })).toBe(false);
  });
  it('never polls with no captures or after an error (NOT_FOUND)', () => {
    expect(jevPollMs(undefined, [], { errored: false, fetches: 0 })).toBe(false);
    expect(jevPollMs(undefined, ['k1'], { errored: true, fetches: 0 })).toBe(false);
  });
  it('re-asks a few times for a capture with no reading yet, then stops (Jev off)', () => {
    expect(jevPollMs({}, ['k1'], { errored: false, fetches: 1 })).toBe(3000);
    expect(jevPollMs({}, ['k1'], { errored: false, fetches: JEV_MISSING_FETCHES })).toBe(false);
  });
});
