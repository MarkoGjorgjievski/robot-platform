// packages/scraper/src/verify/variant-detect.ts
// Finds a product's variants already sitting in a proof-page capture — JSON-LD
// `ProductGroup.hasVariant`, a `Product.offers[]` list with a SKU/price per
// entry, or an API body's `variants[]`-like list (spec 2026-10-01 §3, "Listed
// in the page data"). Pure and free: no browser, no network, no model — reads
// the capture already on hand.
import type { CaptureLike } from './certify.js';

export const VARIANT_AXIS_KEYS = [
  'color', 'colour', 'size', 'length', 'width', 'height', 'material', 'pattern',
  'style', 'capacity', 'flavor', 'flavour', 'scent', 'finish', 'option1', 'option2', 'option3',
] as const;

export type VariantList = {
  source: 'json-ld' | 'api';
  /** Dot path to the array, e.g. 'hasVariant', 'offers', 'product.variants'. */
  path: string;
  count: number;
  /** Axis keys found on the entries, in VARIANT_AXIS_KEYS order (schema.org variesBy first when present). */
  axes: string[];
  /** Up to 50: each entry's axis values plus sku/price when present, as text. */
  entries: Array<Record<string, string>>;
};

const MAX_ENTRIES = 50;
const API_MAX_DEPTH = 6;
const MAX_ARRAY_SCAN = 50;

type PlainObject = Record<string, unknown>;

function isPlainObject(v: unknown): v is PlainObject {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function toText(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return undefined;
}

function isKnownAxisKey(k: string): boolean {
  return (VARIANT_AXIS_KEYS as readonly string[]).includes(k);
}

/** The axis keys an entry carries: direct keys in VARIANT_AXIS_KEYS, plus any `options`/`selectedOptions` entry's `name.toLowerCase()`. */
function axisKeysOf(entry: PlainObject): string[] {
  const keys = new Set<string>();
  for (const k of Object.keys(entry)) if (isKnownAxisKey(k)) keys.add(k);
  for (const optKey of ['options', 'selectedOptions']) {
    const arr = entry[optKey];
    if (!Array.isArray(arr)) continue;
    for (const opt of arr) {
      if (isPlainObject(opt) && typeof opt.name === 'string') keys.add(opt.name.toLowerCase());
    }
  }
  return [...keys];
}

/** Known axis keys first in VARIANT_AXIS_KEYS order, any others (from option names outside the known list) after, alphabetically. */
function orderAxes(keys: Set<string>): string[] {
  const known = VARIANT_AXIS_KEYS.filter((k) => keys.has(k));
  const rest = [...keys].filter((k) => !isKnownAxisKey(k)).sort();
  return [...known, ...rest];
}

function axesFromVariesBy(variesBy: unknown): string[] | null {
  if (!Array.isArray(variesBy)) return null;
  const vals = variesBy
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.replace(/^https?:\/\/schema\.org\//i, '').toLowerCase());
  return vals.length ? vals : null;
}

function entryAxisValue(entry: PlainObject, axisKey: string): string | undefined {
  if (axisKey in entry) {
    const t = toText(entry[axisKey]);
    if (t !== undefined) return t;
  }
  for (const optKey of ['options', 'selectedOptions']) {
    const arr = entry[optKey];
    if (!Array.isArray(arr)) continue;
    for (const opt of arr) {
      if (isPlainObject(opt) && typeof opt.name === 'string' && opt.name.toLowerCase() === axisKey) {
        const t = toText(opt.value);
        if (t !== undefined) return t;
      }
    }
  }
  return undefined;
}

function toEntry(raw: PlainObject, axes: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const axisKey of axes) {
    const v = entryAxisValue(raw, axisKey);
    if (v !== undefined) out[axisKey] = v;
  }
  const sku = toText(raw.sku) ?? toText(raw.mpn) ?? toText(raw.productID);
  if (sku !== undefined) out.sku = sku;
  let price = toText(raw.price);
  if (price === undefined && isPlainObject(raw.offers)) price = toText((raw.offers as PlainObject).price);
  if (price !== undefined) out.price = price;
  return out;
}

function buildList(source: VariantList['source'], path: string, raw: unknown[], variesByAxes: string[] | null): VariantList | null {
  const objs = raw.filter(isPlainObject);
  if (objs.length < 2) return null;
  const keys = new Set<string>();
  for (const o of objs) for (const k of axisKeysOf(o)) keys.add(k);
  const axes = variesByAxes ?? orderAxes(keys);
  const entries = objs.slice(0, MAX_ENTRIES).map((o) => toEntry(o, axes));
  return { source, path, count: raw.length, axes, entries };
}

function jsonLdCandidates(ldJson: unknown[]): VariantList[] {
  const out: VariantList[] = [];
  for (const block of ldJson) {
    if (!isPlainObject(block)) continue;
    const variesByAxes = axesFromVariesBy(block.variesBy);
    if (Array.isArray(block.hasVariant) && block.hasVariant.length >= 2) {
      const list = buildList('json-ld', 'hasVariant', block.hasVariant, variesByAxes);
      if (list) out.push(list);
    }
    if (
      Array.isArray(block.offers) &&
      block.offers.length >= 2 &&
      block.offers.every((o) => isPlainObject(o) && ('sku' in o || 'price' in o))
    ) {
      const list = buildList('json-ld', 'offers', block.offers, variesByAxes);
      if (list) out.push(list);
    }
  }
  return out;
}

function isIdentifiedEntry(e: PlainObject): boolean {
  return 'sku' in e || 'price' in e || 'id' in e || 'variant_id' in e;
}

function hasAxisSignal(e: PlainObject): boolean {
  if (Object.keys(e).some(isKnownAxisKey)) return true;
  return Array.isArray(e.options) || Array.isArray(e.selectedOptions);
}

function qualifiesAsApiVariantArray(arr: unknown[]): boolean {
  if (arr.length < 2 || !arr.every(isPlainObject)) return false;
  const objs = arr as PlainObject[];
  if (objs.filter(isIdentifiedEntry).length < 2) return false;
  return objs.some(hasAxisSignal);
}

function collectApiArrays(value: unknown, path: string, depth: number, out: Array<{ path: string; arr: unknown[] }>): void {
  if (depth > API_MAX_DEPTH) return;
  if (Array.isArray(value)) {
    if (path !== '') out.push({ path, arr: value });
    value.slice(0, MAX_ARRAY_SCAN).forEach((v, i) => collectApiArrays(v, `${path}[${i}]`, depth + 1, out));
    return;
  }
  if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) collectApiArrays(v, path === '' ? k : `${path}.${k}`, depth + 1, out);
  }
}

function apiCandidates(capture: Pick<CaptureLike, 'interceptedRequests'>): VariantList[] {
  const out: VariantList[] = [];
  for (const req of capture.interceptedRequests) {
    if (!req.isJson || req.parsedJson === null || req.parsedJson === undefined) continue;
    const arrays: Array<{ path: string; arr: unknown[] }> = [];
    collectApiArrays(req.parsedJson, '', 0, arrays);
    for (const { path, arr } of arrays) {
      if (!qualifiesAsApiVariantArray(arr)) continue;
      const list = buildList('api', path, arr, null);
      if (list) out.push(list);
    }
  }
  return out;
}

/** Best first: JSON-LD before API, longer `count` first; at most 3 lists. */
export function detectVariantLists(capture: CaptureLike): VariantList[] {
  const lists = [...jsonLdCandidates(capture.structuredData.ldJson), ...apiCandidates(capture)];
  lists.sort((a, b) => (a.source !== b.source ? (a.source === 'json-ld' ? -1 : 1) : b.count - a.count));
  return lists.slice(0, 3);
}
