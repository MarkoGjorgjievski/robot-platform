// packages/scraper/src/verify/defaults.ts
// A website's default (spec 2026-10-13 §5): written into every cell the
// certified paths leave empty, in the form a path would have written.
import { normalize, renderValue, storedText } from './normalize.js';
import type { CustomerFieldType } from './types.js';

export type DefaultedField = { key: string; type: CustomerFieldType; defaultValue?: string };

/** The default as a run writes it — `evaluatePath`'s own rendering: text as `storedText` keeps it
 * (its own characters, whitespace collapsed and trimmed), every other type (including a list) parsed by `normalize` and rendered by
 * `renderValue` — the same production chain a path's hit goes through, so a default-filled cell
 * and a path-filled cell of the same field render identically. Null when the text does not parse
 * for the type. */
export function renderDefault(type: CustomerFieldType, value: string): unknown {
  const norm = normalize(type, value);
  if (norm === null) return null;
  return type === 'text' ? storedText(value) : renderValue(type, norm);
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
