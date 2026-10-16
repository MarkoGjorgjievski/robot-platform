import { describe, expect, it } from 'vitest';
import { agreementOf } from './jev-agreement.js';

const set = { urls: ['u1', 'u2'], expected: { price: { u1: '374.25', u2: '449.25' } } } as never;
const reading = (url: string, pick: string, cands: Array<[string, string]>, variant?: { pick: string; pageMatch: string | null }) => ({
  id: `r-${url}`, url,
  answers: { fields: { price: { candidates: cands.map(([id, value]) => ({ id, value, source: 's' })), pick, p: 0.97 } }, ...(variant ? { variant: { entries: [], p: 0.9, ...variant } } : {}) },
}) as never;

describe('agreementOf', () => {
  it('compares Jev\'s pick with the verified value by amount', () => {
    const a = agreementOf([{ key: 'price', type: 'money' }], set, [reading('u1', 'c1', [['c1', '$374.25'], ['c2', '$499.00']]), reading('u2', 'c2', [['c1', '449.25'], ['c2', '599.00']])])!;
    expect(a.asked).toBe(2);
    expect(a.agreed).toBe(1);
    expect(a.pages.u1!.fields.price).toMatchObject({ pick: 'c1', value: '$374.25', expected: '374.25', agree: true });
    expect(a.pages.u2!.fields.price!.agree).toBe(false);
  });
  it('a none pick never agrees with a value', () => {
    expect(agreementOf([{ key: 'price', type: 'money' }], set, [reading('u1', 'none', [['c1', '374.25'], ['c2', '499']])])!.pages.u1!.fields.price!.agree).toBe(false);
  });
  it('records the variant pick against the [page] match', () => {
    const a = agreementOf([{ key: 'price', type: 'money' }], set, [reading('u1', 'c1', [['c1', '374.25'], ['c2', '499']], { pick: 'e3', pageMatch: 'e3' })])!;
    expect(a.pages.u1!.variant).toEqual({ pick: 'e3', pageMatch: 'e3', agree: true });
  });
  it('no readings → null', () => {
    expect(agreementOf([{ key: 'price', type: 'money' }], set, [])).toBeNull();
  });
  it('text compares by normalised text; a field with no expected value on the page is not asked', () => {
    const s = { urls: ['u1'], expected: { title: { u1: 'Widget  A' }, brand: { u1: '' } } } as never;
    const r = { id: 'r', url: 'u1', answers: { fields: {
      title: { candidates: [{ id: 'c1', value: 'widget a', source: 's' }, { id: 'c2', value: 'Widget B', source: 's' }], pick: 'c1', p: 0.9 },
      brand: { candidates: [{ id: 'c1', value: 'X', source: 's' }, { id: 'c2', value: 'Y', source: 's' }], pick: 'c1', p: 0.9 },
    } } } as never;
    const a = agreementOf([{ key: 'title', type: 'text' }, { key: 'brand', type: 'text' }], s, [r])!;
    expect(a).toMatchObject({ asked: 1, agreed: 1 });
    expect(a.pages.u1!.fields.brand).toBeUndefined();
  });
  it('records whether the field certified when the results are given (spec §7)', () => {
    const a = agreementOf([{ key: 'price', type: 'money' }], set, [reading('u1', 'c1', [['c1', '374.25'], ['c2', '499']])], { price: true })!;
    expect(a.pages.u1!.fields.price!.certified).toBe(true);
    expect(agreementOf([{ key: 'price', type: 'money' }], set, [reading('u1', 'c1', [['c1', '374.25'], ['c2', '499']])])!.pages.u1!.fields.price).not.toHaveProperty('certified');
  });
});
