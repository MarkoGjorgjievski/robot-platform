import { describe, it, expect } from 'vitest';
import { applyDefaults, renderDefault } from './defaults.js';

describe('renderDefault', () => {
  it('writes the default as a path would: parsed for the type, text NFKC-collapsed, nothing when it does not parse', () => {
    expect(renderDefault('text', '  Gymshark   Ltd ')).toBe('Gymshark Ltd');
    expect(renderDefault('money', '22')).toBe(22);
    expect(renderDefault('number', '4,5')).toBe(4.5);
    expect(renderDefault('boolean', 'yes')).toBe(true);
    expect(renderDefault('boolean', 'out of stock')).toBe(false);
    // text_list goes through the same normalize/renderValue chain evaluatePath uses for a path's
    // hit: lowercased, deduped, sorted (normalize.ts's list()) — not the operator's own casing.
    expect(renderDefault('text_list', 'Red, Blue')).toEqual(['blue', 'red']);
    expect(renderDefault('money', 'call us')).toBeNull();
  });
});

describe('applyDefaults (spec 2026-10-13 §5, property 5)', () => {
  const fields = [
    { key: 'brand', type: 'text' as const, defaultValue: 'Gymshark' },
    { key: 'price', type: 'money' as const, defaultValue: '22' },
    { key: 'title', type: 'text' as const },
    { key: 'bad', type: 'money' as const, defaultValue: 'call us' },
  ];
  it('fills only the cells every path left empty, names them, and leaves the input row alone', () => {
    const row = { brand: null, price: 19.5, title: null, bad: null };
    const r = applyDefaults(row, fields);
    expect(r.row).toEqual({ brand: 'Gymshark', price: 19.5, title: null, bad: null });
    expect(r.defaulted).toEqual(['brand']);
    expect(row.brand).toBeNull();
  });
  it('treats undefined and the empty string as empty, and a field with no default as untouched', () => {
    // brand's key is absent here too (undefined, same as in the row below) — it defaults
    // alongside price, demonstrating the empty-string rule and the undefined rule together.
    expect(applyDefaults({ price: '' }, fields)).toEqual({ row: { brand: 'Gymshark', price: 22 }, defaulted: ['brand', 'price'] });
    expect(applyDefaults({}, fields)).toEqual({ row: { brand: 'Gymshark', price: 22 }, defaulted: ['brand', 'price'] });
    expect(applyDefaults({ title: null }, [{ key: 'title', type: 'text' }])).toEqual({ row: { title: null }, defaulted: [] });
  });
});
