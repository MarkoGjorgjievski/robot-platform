// packages/scraper/src/verify/jev-candidates.ts
// What a Jev reading may choose among (spec 2026-10-16 §4): verbatim values our
// code finds, never free page text. Moved from the experiment CLI
// (packages/api/src/jev-images-run.ts, `candidatesFor`), plus the variant
// options experiment 2 asked about.
import type { PageCapture } from '@robot/browser';
import type { Box } from './box-map.js';
import { visibleTextFromHtml } from '../corroborate-value.js';
import { pathFitsConcept } from './field-fit.js';
import { normalize } from './normalize.js';
import { detectVariantLists, entryAxisValue, isVariantEntry } from './variant-detect.js';
import { pickPageEntry } from './page-variant-match.js';
import type { CustomerFieldType } from './types.js';

export type JevField = { key: string; name: string; type: CustomerFieldType; concept: string; description?: string };
export type JevCandidate = { id: string; value: string; source: string };
export type JevVariantOption = { id: string; label: string; entryIndex: number };
export const JEV_FIELD_TYPES: readonly CustomerFieldType[] = ['text', 'money', 'number'];
export const JEV_MAX_FIELD_OPTIONS = 30;
export const JEV_MAX_VARIANT_OPTIONS = 40;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
const normText = (s: string) => s.normalize('NFKC').replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();

type Leaf = { source: string; path: string; raw: unknown };
function leaves(value: unknown, path: string, depth: number, out: Leaf[], source: string): void {
  if (depth > 12 || out.length > 5000) return;
  if (Array.isArray(value)) { value.slice(0, 30).forEach((v, i) => leaves(v, `${path}[${i}]`, depth + 1, out, source)); return; }
  if (isObj(value)) { for (const [k, v] of Object.entries(value)) leaves(v, path === '' ? k : `${path}.${k}`, depth + 1, out, source); return; }
  if (path !== '' && value !== null && value !== undefined && value !== '') out.push({ source, path, raw: value });
}

/** The key a value is told apart by: money and numbers by amount, text by normalised text. */
function keyOf(type: CustomerFieldType, v: string): string | null {
  if (type === 'money' || type === 'number') { const n = normalize(type, v); return n === null ? null : String(n); }
  const t = normText(v);
  return t === '' ? null : t;
}

/**
 * The page's rendered heading text — exactly as `packages/api/src/routers/sources.ts` `headingTextFrom`
 * does: the first rendered `<h1>` in the html (scripts/styles stripped first, so a templated `<h1>` in
 * a `<script>` never counts, and a nested `<span>` is read, unlike a box's own-text-only `.text`), else
 * the largest h1/h2/h3 box's own text.
 */
function headingTextFrom(html: string, boxes: Box[]): string | null {
  const markup = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const h1 = /<h1(?:\s[^>]*)?>([\s\S]*?)<\/h1\s*>/i.exec(markup);
  if (h1) return visibleTextFromHtml(h1[1]!).trim();
  let best: Box | null = null;
  for (const b of boxes) {
    if (b.tag.toLowerCase() !== 'h1' && b.tag.toLowerCase() !== 'h2' && b.tag.toLowerCase() !== 'h3') continue;
    if (!best || b.rect.w * b.rect.h > best.rect.w * best.rect.h) best = b;
  }
  return best ? best.text.trim() : null;
}

/**
 * Choice candidates for a field: distinct values of the page's structured leaves whose path fits the
 * field (JSON-LD and meta), plus the visible strings for it — money strings near the heading for a
 * price, the heading and og:title for a name, og:site_name/product:brand for a brand. Verbatim; ≤ 30.
 * `html` is the capture's rendered html, read for the heading text (a wrapped `<h1><span>…</span></h1>`
 * has no text of its own on the box); omit it to fall back to the box's own text only.
 */
export function jevFieldCandidates(field: JevField, structured: { ldJson: unknown[]; meta: Record<string, string> }, boxes: Box[], html = ''): JevCandidate[] {
  const out: Array<Omit<JevCandidate, 'id'>> = [];
  const seen = new Set<string>();
  const add = (value: string, source: string) => {
    const v = value.replace(/\s+/g, ' ').trim();
    if (v === '' || v.length > 200) return;
    const k = keyOf(field.type, v);
    if (k === null || seen.has(k)) return;
    seen.add(k);
    out.push({ value: v, source });
  };
  const ls: Leaf[] = [];
  structured.ldJson.forEach((b) => leaves(b, '', 0, ls, 'json-ld'));
  for (const [k, v] of Object.entries(structured.meta)) ls.push({ source: 'meta', path: k, raw: v });
  for (const l of ls) {
    if (!pathFitsConcept(field.concept, l.path)) continue;
    if ((field.type === 'money' || field.type === 'number') && normalize(field.type, l.raw) === null) continue;
    add(String(l.raw), `${l.source} ${l.path}`);
  }
  if (field.concept === 'brand') for (const k of ['og:site_name', 'application-name', 'product:brand']) if (structured.meta[k]) add(structured.meta[k]!, `meta ${k}`);
  if (field.concept === 'product_name') {
    const heading = headingTextFrom(html, boxes);
    if (heading) add(heading, 'visible h1');
    if (structured.meta['og:title']) add(structured.meta['og:title'], 'meta og:title');
  }
  if (field.concept === 'price') {
    const h1 = boxes.find((b) => b.tag.toLowerCase() === 'h1')?.rect;
    const moneyText = /^[^\d]{0,8}[$£€]\s?\d[\d,]*(\.\d{1,2})?\s*$|^\s*\d[\d,]*(\.\d{1,2})?\s?(€|£)\s*$/;
    for (const b of [...boxes].sort((a, c) => a.rect.y - c.rect.y || a.rect.x - c.rect.x)) {
      if (!moneyText.test(b.text)) continue;
      if (h1 ? Math.abs(b.rect.y - h1.y) > 700 || Math.abs(b.rect.x - h1.x) > 900 : b.rect.y > 1200) continue;
      add(b.text, 'visible');
    }
  }
  return out.slice(0, JEV_MAX_FIELD_OPTIONS).map((c, i) => ({ id: `c${i + 1}`, ...c }));
}

export function isAmbiguous(field: JevField, candidates: JevCandidate[]): boolean {
  return JEV_FIELD_TYPES.includes(field.type) && candidates.length >= 2;
}

const variesByOf = (container: unknown): string[] => {
  const v = isObj(container) ? container.variesBy : undefined;
  return (Array.isArray(v) ? v : v === undefined ? [] : [v]).filter((x): x is string => typeof x === 'string')
    .map((t) => t.replace(/^https?:\/\/schema\.org\//i, '').trim()).filter(Boolean);
};
function getAt(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const part of path.split(/\.|\[(\d+)\]/).filter(Boolean)) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = Array.isArray(cur) ? cur[Number(part)] : (cur as Obj)[part];
  }
  return cur;
}

/** An entry's verbatim name, title and option values (never a price, a stock level, an id or an address). */
function entryLabel(e: Obj, axes: string[]): string {
  const parts: string[] = [];
  const add = (v: unknown) => {
    if (typeof v !== 'string' && typeof v !== 'number') return;
    const t = String(v).replace(/\s+/g, ' ').trim();
    if (!t || t.length > 140 || /^https?:/.test(t)) return;
    if (parts.some((p) => p.toLowerCase().includes(t.toLowerCase()))) return;
    parts.push(t);
  };
  add(e.name); add(e.title); add(e.public_title);
  for (const a of axes) add(entryAxisValue(e, a));
  for (const k of ['size', 'color', 'colour', 'option1', 'option2', 'option3']) add(e[k]);
  for (const k of ['selectedOptions', 'options', 'additionalProperty']) {
    const v = e[k];
    for (const o of Array.isArray(v) ? v : isObj(v) ? [v] : []) if (isObj(o) && typeof o.name === 'string' && (typeof o.value === 'string' || typeof o.value === 'number')) add(`${o.name}: ${o.value}`);
  }
  return parts.join(' · ');
}

/**
 * The variant question's options (spec 2026-10-16 §4): the first variant list the page data carries,
 * each entry labelled by its option values and name, ≤ 40 keeping the `[page]` match; `pageMatch` is
 * the option `pickPageEntry` reads with the capture's page variant, or null. Null without a list.
 */
export function jevVariantOptions(capture: Pick<PageCapture, 'structuredData' | 'interceptedRequests' | 'pageVariant'>): { options: JevVariantOption[]; pageMatch: string | null } | null {
  const list = detectVariantLists(capture as never)[0];
  if (!list) return null;
  const roots: unknown[] = [];
  if (list.source === 'json-ld') {
    for (const b of capture.structuredData.ldJson) { if (!isObj(b)) continue; roots.push(b); if (Array.isArray(b['@graph'])) roots.push(...b['@graph']); }
  } else {
    for (const r of capture.interceptedRequests) if (r.isJson && r.parsedJson != null) roots.push(r.parsedJson);
  }
  for (const root of roots) {
    const arr = getAt(root, list.path);
    if (!Array.isArray(arr)) continue;
    const entries = arr.map((e, idx) => ({ e, idx })).filter((x) => isObj(x.e) && isVariantEntry(x.e as Obj));
    // Only the array `[page]` would really read — a same-named array shaped differently on another root is not it.
    if (entries.length !== list.count) continue;
    const dot = list.path.lastIndexOf('.');
    const container = dot < 0 ? root : getAt(root, list.path.slice(0, dot));
    const axes = variesByOf(container);
    let options: JevVariantOption[] = entries.map((x, k) => ({ id: `e${k + 1}`, label: entryLabel(x.e as Obj, list.axes), entryIndex: x.idx }));
    // Empty or repeated labels: the sku (or the entry number) tells them apart.
    const seen = new Map<string, number>();
    for (const o of options) seen.set(o.label, (seen.get(o.label) ?? 0) + 1);
    for (let i = 0; i < options.length; i++) {
      const o = options[i]!;
      if (o.label !== '' && seen.get(o.label) === 1) continue;
      const e = entries[i]!.e as Obj;
      const sku = typeof e.sku === 'string' ? e.sku : typeof e.mpn === 'string' ? e.mpn : null;
      o.label = `${o.label}${o.label ? ' ' : ''}(${sku ? `SKU ${sku}` : `entry ${o.entryIndex + 1}`})`;
    }
    const hit = capture.pageVariant ? pickPageEntry(arr, capture.pageVariant, axes) : undefined;
    const matchIdx = hit === undefined ? null : arr.indexOf(hit);
    if (options.length > JEV_MAX_VARIANT_OPTIONS) {
      const keep = new Set<number>([options[0]!.entryIndex, ...(matchIdx !== null ? [matchIdx] : [])]);
      const step = options.length / (JEV_MAX_VARIANT_OPTIONS - keep.size);
      for (let k = 0; keep.size < JEV_MAX_VARIANT_OPTIONS && k < options.length; k = Math.max(k + 1, Math.floor(k + step))) keep.add(options[k]!.entryIndex);
      options = options.filter((o) => keep.has(o.entryIndex));
    }
    const pageMatch = matchIdx === null ? null : options.find((o) => o.entryIndex === matchIdx)?.id ?? null;
    return { options, pageMatch };
  }
  return null;
}
