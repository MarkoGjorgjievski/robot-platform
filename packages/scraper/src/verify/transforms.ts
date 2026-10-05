import type { CustomerFieldType, Transform } from './types.js';
import { normalize, valuesEqual, type NormalizeContext } from './normalize.js';

export const TRANSFORMS: readonly Transform[] = ['identity', 'cents_to_units', 'first_of_list'];

const APPLICABLE: Record<CustomerFieldType, readonly Transform[]> = {
  text: ['identity', 'first_of_list'],
  number: ['identity', 'cents_to_units', 'first_of_list'],
  money: ['identity', 'cents_to_units', 'first_of_list'],
  boolean: ['identity', 'first_of_list'],
  date: ['identity', 'first_of_list'],
  url: ['identity', 'first_of_list'],
  image: ['identity', 'first_of_list'],
  text_list: ['identity'],
};

export function applyTransform(raw: unknown, t: Transform): unknown {
  switch (t) {
    case 'identity': return raw;
    case 'cents_to_units': {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw) : null;
      return n === null ? raw : Math.round(n) / 100;
    }
    case 'first_of_list': return Array.isArray(raw) ? raw[0] : raw;
  }
}

export function inferTransform(type: CustomerFieldType, raw: unknown, expected: string, ctx?: NormalizeContext): Transform | null {
  for (const t of APPLICABLE[type]) {
    const v = applyTransform(raw, t);
    if (normalize(type, v, ctx) !== null && valuesEqual(type, v, expected, ctx)) return t;
  }
  return null;
}

/**
 * The first transform that makes `raw` parse as this type at all — same
 * order as `inferTransform`, but with no expected value to match: used where
 * a candidate's value doesn't matter, only that it IS some valid instance of
 * the type (drift's "changed" search, which is hunting for a value that has
 * changed, not one that matches anything).
 */
export function inferTransformForType(type: CustomerFieldType, raw: unknown, ctx?: NormalizeContext): Transform | null {
  for (const t of APPLICABLE[type]) {
    const v = applyTransform(raw, t);
    if (normalize(type, v, ctx) !== null) return t;
  }
  return null;
}
