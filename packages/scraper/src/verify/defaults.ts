// packages/scraper/src/verify/defaults.ts
// A website's default (spec 2026-10-13 §5): written into every cell the
// certified paths leave empty, in the form a path would have written.
import { normalize, renderValue } from './normalize.js';
import type { CustomerFieldType } from './types.js';

export type DefaultedField = { key: string; type: CustomerFieldType; defaultValue?: string };

const collapse = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').trim();

/** The default as a run writes it — `evaluatePath`'s own rendering: text NFKC-collapsed and
 * trimmed, every other type parsed and rendered. A list keeps the operator's own casing and
 * order (unlike a path's cross-validation form, which normalizes a list for equality, not
 * display). Null when the text does not parse for the type. */
export function renderDefault(type: CustomerFieldType, value: string): unknown {
  const norm = normalize(type, value);
  if (norm === null) return null;
  if (type === 'text') return collapse(value);
  if (type === 'text_list') return value.split(/[\n,;]/).map(collapse).filter((s) => s !== '');
  return renderValue(type, norm);
}

const isEmpty = (v: unknown) => v === null || v === undefined || v === '';

/** Fills each field's default into the row where the cell is empty; returns a new row and the keys it filled, in field order. The input row is not changed. */
export function applyDefaults(row: Record<string, unknown>, fields: DefaultedField[]): { row: Record<string, unknown>; defaulted: string[] } {
  const out = { ...row };
  const defaulted: string[] = [];
  for (const f of fields) {
    if (f.defaultValue === undefined || !isEmpty(out[f.key])) continue;
    const rendered = renderDefault(f.type, f.defaultValue);
    if (rendered === null) continue;
    out[f.key] = rendered;
    defaulted.push(f.key);
  }
  return { row: out, defaulted };
}
