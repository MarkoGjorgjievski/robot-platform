// packages/scraper/src/verify/suggest-marks.ts
// Pre-highlights for the mark screen (spec 2026-09-18 §3.3), free and pure:
// the structured data a capture already carries, matched to the elements that
// show it. No model: the customer is one click away on a screen built for it.
import type { CaptureLike } from './certify.js';
import type { Box } from './box-map.js';
import { normalize, valuesEqual } from './normalize.js';
import type { SchemaDefinitionField } from './types.js';

export type Suggestion = {
  value: string;
  via: { source: 'api' | 'json-ld' | 'meta'; path: string };
  boxes: number[];
};

/** Path tails that carry a concept, by concept (deriveConcept's vocabulary). Matched against the end of a dotted path with array indices removed. */
const CONCEPT_PATHS: Record<string, string[]> = {
  product_name: ['name', 'og:title', 'title', 'productName', 'product_name', 'headline'],
  price: ['offers.price', 'price', 'product:price:amount', 'currentPrice', 'current_price', 'salePrice', 'sale_price'],
  description: ['description', 'og:description', 'productDescription', 'product_description'],
  image_url: ['image', 'images', 'og:image', 'image.url', 'thumbnailUrl', 'primary_image_url'],
  brand: ['brand.name', 'brand', 'manufacturer', 'brand_name'],
  sku: ['sku', 'productID', 'mpn', 'gtin', 'gtin13', 'code', 'item_id', 'product_id'],
  availability: ['offers.availability', 'availability', 'in_stock', 'is_available'],
  rating: ['aggregateRating.ratingValue', 'ratingValue', 'rating'],
  review_count: ['aggregateRating.reviewCount', 'reviewCount', 'review_count', 'ratingCount'],
  currency: ['offers.priceCurrency', 'priceCurrency', 'product:price:currency'],
};

/** JSON-LD is canonical, meta next, API bodies last: an API body is noisy (`priceCents: 12999` would be offered as the price). */
const SOURCE_ORDER: Array<Suggestion['via']['source']> = ['json-ld', 'meta', 'api'];
const MAX_DEPTH = 12;
const MAX_ARRAY_ITEMS = 25;

type Leaf = { source: Suggestion['via']['source']; path: string; raw: unknown };

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
        const leaf = all.find((l) => l.source === source && tailMatches(l.path, tail) && normalize(field.type, l.raw, ctx) !== null);
        if (!leaf) continue;
        const value = valueText(leaf.raw)!;
        const matching = boxes.map((b, i) => (valuesEqual(field.type, boxValue(b), value, ctx) ? i : -1)).filter((i) => i >= 0);
        found = { value, via: { source, path: leaf.path }, boxes: matching };
        break;
      }
      if (found) break;
    }
    out[field.key] = found;
  }
  return out;
}
