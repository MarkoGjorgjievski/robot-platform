// packages/scraper/src/verify/suggest-marks.ts
// Pre-highlights for the mark screen (spec 2026-09-18 §3.3), free and pure:
// the structured data a capture already carries, matched to the elements that
// show it. No model: the customer is one click away on a screen built for it.
import type { CaptureLike } from './certify.js';
import type { Box } from './box-map.js';
import { normalize, valuesEqual } from './normalize.js';
import { CONCEPT_PATHS } from './field-fit.js';
import type { SchemaDefinitionField } from './types.js';
import { visibleTextFromHtml } from '../corroborate-value.js';

/** `xpath`: the element that shows the page's heading (a Title only, first run 2026-10-25) — never a structured path. */
export type Suggestion = {
  value: string;
  via: { source: 'api' | 'json-ld' | 'meta' | 'xpath'; path: string };
  boxes: number[];
};

/** JSON-LD is canonical, meta next, API bodies last: an API body is noisy (`priceCents: 12999` would be offered as the price). */
const SOURCE_ORDER: Array<Leaf['source']> = ['json-ld', 'meta', 'api'];
const MAX_DEPTH = 12;
const MAX_ARRAY_ITEMS = 25;

type Leaf = { source: 'api' | 'json-ld' | 'meta'; path: string; raw: unknown };

function leaves(capture: CaptureLike): Leaf[] {
  const out: Leaf[] = [];
  const walk = (source: Leaf['source'], value: unknown, path: string, depth: number) => {
    if (depth > MAX_DEPTH) return;
    if (Array.isArray(value)) {
      // The array is itself a candidate (e.g. a text_list field matches the whole list) before its
      // items are, matching searchStructured's convention: a container reading beats a lone element.
      if (path) out.push({ source, path, raw: value });
      value.slice(0, MAX_ARRAY_ITEMS).forEach((v, i) => walk(source, v, `${path}[${i}]`, depth + 1));
      return;
    }
    if (value !== null && typeof value === 'object') { for (const [k, v] of Object.entries(value as Record<string, unknown>)) walk(source, v, path ? `${path}.${k}` : k, depth + 1); return; }
    if (path) out.push({ source, path, raw: value });
  };
  for (const b of capture.structuredData.ldJson) walk('json-ld', b, '', 0);
  for (const [k, v] of Object.entries(capture.structuredData.meta)) out.push({ source: 'meta', path: k, raw: v });
  for (const r of capture.interceptedRequests) if (r.isJson && r.parsedJson !== null) walk('api', r.parsedJson, '', 0);
  return out;
}

function tailMatches(path: string, tail: string): boolean {
  const p = path.replace(/\[\d+\]/g, '');
  return p === tail || p.endsWith(`.${tail}`);
}

/** Segment count with array indices removed, for depth comparison — not identity. */
function depthOf(path: string): number {
  return path.replace(/\[\d+\]/g, '').split('.').length;
}

function valueText(raw: unknown): string | null {
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  if (Array.isArray(raw)) { const parts = raw.map(valueText).filter((s): s is string => s !== null); return parts.length ? parts.join(', ') : null; }
  return null;
}

function boxValue(box: Box): string {
  return box.kind === 'image' ? box.src ?? '' : box.kind === 'link' ? box.href || box.text : box.text;
}

export function suggestMarks(capture: CaptureLike, boxes: Box[], fields: SchemaDefinitionField[]): Record<string, Suggestion | null> {
  const all = leaves(capture);
  const ctx = { pageUrl: capture.url };
  const out: Record<string, Suggestion | null> = {};
  for (const field of fields) {
    const tails = CONCEPT_PATHS[field.concept] ?? [field.key, field.concept];
    let found: Suggestion | null = null;
    for (const source of SOURCE_ORDER) {
      for (const tail of tails) {
        const matches = all.filter((l) => l.source === source && tailMatches(l.path, tail) && normalize(field.type, l.raw, ctx) !== null);
        if (matches.length === 0) continue;
        // Ikea 2026-09-18: a BreadcrumbList block can precede the Product block in ldJson, and both
        // end in `name` — the breadcrumb's `itemListElement[0].name` must not beat the product's own
        // `name`. Within one (source, tail), prefer the shallowest path; ties keep document order.
        const leaf = matches.reduce((best, l) => (depthOf(l.path) < depthOf(best.path) ? l : best));
        const value = valueText(leaf.raw)!;
        const matching = boxes.map((b, i) => (valuesEqual(field.type, boxValue(b), value, ctx) ? i : -1)).filter((i) => i >= 0);
        found = { value, via: { source, path: leaf.path }, boxes: matching };
        break;
      }
      if (found) break;
    }
    out[field.key] = field.concept === 'product_name' ? preferHeading(found, capture, boxes, all, tails, field, ctx) : found;
  }
  return out;
}

/**
 * The proof page's main heading (spec 2026-10-12 §B1): the first `<h1>` in
 * the capture's HTML, its whole visible text; only when the HTML has no `h1`,
 * the largest of the box map's `h1`/`h2`/`h3` by area; else none. Read from
 * the HTML because a box carries only its element's own text nodes, so an
 * `<h1><span>Widget A</span></h1>` has no `h1` box at all and a split
 * `Super Shock <em>Shadow</em>` box reads "Super Shock" (final review I3).
 */
export function pageHeading(html: string, boxes: Box[]): string | null {
  // Scripts and styles out first: a template `<script>` can carry an `<h1>` the page never renders.
  const markup = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const h1 = /<h1(?:\s[^>]*)?>([\s\S]*?)<\/h1\s*>/i.exec(markup);
  if (h1) return visibleTextFromHtml(h1[1]!).trim();
  let best: Box | null = null;
  for (const b of boxes) {
    if (b.tag !== 'h1' && b.tag !== 'h2' && b.tag !== 'h3') continue;
    if (!best || b.rect.w * b.rect.h > best.rect.w * best.rect.h) best = b;
  }
  return best ? best.text.trim() : null;
}

/** NFKC + whitespace-collapse + lower-case: the heading rule's own comparison (the app's `sameHeading`). */
const normHeading = (v: string) => v.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
export function sameHeading(a: string, b: string): boolean { return normHeading(a) === normHeading(b); }

/** In or on the page's `h1`: the element's tag, or an `h1` step in one of its XPaths. */
const inH1 = (b: Box) => b.tag === 'h1' || b.xpaths.some((x) => /\/h1(?:\[|\/|$)/.test(x));
/** An element a customer can point at on the screenshot (the app's `pointable`). */
const onScreenshot = (b: Box) => b.rect.w >= 4 && b.rect.h >= 4 && b.rect.x >= 0 && b.rect.y >= 0;

/**
 * A Title prefers the page's heading (first run 2026-10-25: "Crusher® 720 - Primer" in the page
 * data, "Crusher® 720" in the h1). The heading rule (spec 2026-10-12 §B1) never agrees a Title
 * that is not the heading, so a page-data name with the colour attached left the customer with
 * nothing to accept. When the suggestion is not the heading and a path reads the heading, that is
 * the suggestion: a structured value equal to it (JSON-LD, meta, then API, on the Title's own
 * tails), else the one element that shows it — in the h1 first, then an h2/h3, then the largest.
 * Neither → the suggestion as it was, and the row says what it needs.
 */
function preferHeading(
  found: Suggestion | null, capture: CaptureLike, boxes: Box[], all: Leaf[], tails: string[], field: SchemaDefinitionField, ctx: { pageUrl: string },
): Suggestion | null {
  const heading = pageHeading(capture.html ?? '', boxes);
  if (!heading) return found;
  if (found && sameHeading(found.value, heading)) return found;
  for (const source of SOURCE_ORDER) {
    for (const tail of tails) {
      const leaf = all.find((l) => l.source === source && tailMatches(l.path, tail) && typeof l.raw === 'string' && sameHeading(l.raw, heading));
      if (!leaf) continue;
      const value = leaf.raw as string;
      const matching = boxes.map((b, i) => (valuesEqual(field.type, boxValue(b), value, ctx) ? i : -1)).filter((i) => i >= 0);
      return { value, via: { source, path: leaf.path }, boxes: matching };
    }
  }
  const showing = boxes
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => b.kind === 'text' && onScreenshot(b) && b.xpaths.length > 0 && sameHeading(b.text, heading));
  if (showing.length === 0) return found;
  const rank = (b: Box) => (inH1(b) ? 0 : b.tag === 'h2' || b.tag === 'h3' ? 1 : 2);
  const best = showing.reduce((a, c) => {
    const d = rank(c.b) - rank(a.b);
    return d < 0 || (d === 0 && c.b.rect.w * c.b.rect.h > a.b.rect.w * a.b.rect.h) ? c : a;
  });
  return { value: best.b.text.trim(), via: { source: 'xpath', path: best.b.xpaths[0]! }, boxes: [best.i] };
}
