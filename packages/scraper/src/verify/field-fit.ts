// Which structured paths may stand for a field whose values alone cannot tell
// paths apart (spec 2026-09-29 C2). One vocabulary for suggestions, the carry
// and certification.
import { normalize } from './normalize.js';
import type { CustomerFieldType } from './types.js';

/** Path tails that carry a concept, by concept (deriveConcept's vocabulary). Matched against the end of a path with array indices removed; "." and ":" (meta keys such as og:price:currency) both separate segments. */
export const CONCEPT_PATHS: Record<string, string[]> = {
  product_name: ['name', 'og:title', 'title', 'productName', 'product_name', 'headline'],
  price: ['offers.price', 'price', 'product:price:amount', 'currentPrice', 'current_price', 'salePrice', 'sale_price'],
  description: ['description', 'og:description', 'productDescription', 'product_description'],
  image_url: ['image', 'images', 'og:image', 'image.url', 'thumbnailUrl', 'primary_image_url'],
  brand: ['brand.name', 'brand', 'manufacturer', 'manufacturer.name', 'vendor', 'brandName', 'brand_name', 'product:brand', 'og:brand'],
  sku: ['sku', 'productID', 'mpn', 'gtin', 'gtin13', 'code', 'item_id', 'product_id'],
  availability: ['offers.availability', 'availability', 'inStock', 'in_stock', 'isAvailable', 'is_available', 'stock', 'stockStatus', 'stock_status', 'available', 'buyable', 'purchasable', 'isInStock', 'is_in_stock', 'availableForSale', 'isBuyable', 'orderable', 'product:availability', 'og:availability'],
  rating: ['aggregateRating.ratingValue', 'ratingValue', 'rating'],
  review_count: ['aggregateRating.reviewCount', 'reviewCount', 'review_count', 'ratingCount'],
  currency: ['offers.priceCurrency', 'priceCurrency', 'product:price:currency', 'currency', 'currencyCode', 'currency_code', 'currencySymbol', 'currency_symbol', 'currencyPrefix'],
};

/** Does this structured path's tail (whole segments split on "." or ":", array indices removed, any case) name the concept? Unknown concept: no. */
export function pathFitsConcept(concept: string, path: string): boolean {
  const tails = CONCEPT_PATHS[concept];
  if (!tails) return false;
  const p = path.replace(/\[\d+\]/g, '').toLowerCase();
  return tails.some((t) => { const x = t.toLowerCase(); return p === x || p.endsWith(`.${x}`) || p.endsWith(`:${x}`); });
}

/**
 * Where a concept-fitting path ranks in `CONCEPT_PATHS[concept]`'s vocabulary
 * order: the index of the path's last segment (lower-cased, `[n]` stripped,
 * split on "." or ":") among that concept's tails. Lower ranks first — for
 * `sku` that puts `sku` before `productID`, `mpn` and `gtin` (plan 2026-10-02
 * Global Constraints), so a barcode never outranks the real SKU. An unknown
 * concept or a segment absent from its vocabulary ranks past every known one.
 */
export function conceptRank(concept: string, path: string): number {
  const tails = CONCEPT_PATHS[concept];
  if (!tails) return Number.MAX_SAFE_INTEGER;
  const seg = path.replace(/\[\d+\]/g, '').split(/[.:]/).pop()!.toLowerCase();
  const idx = tails.findIndex((t) => t.toLowerCase() === seg);
  return idx === -1 ? tails.length : idx;
}

/** Normalises one expected value the way the same-value comparison (isWeakField, weakEvidence) needs: text case-insensitively, everything else via `normalize`, as `valuesEqual` does. Shared so the "is this weak" check and the "was this weak" flag can never disagree. */
export function normalizeForWeak(type: CustomerFieldType, value: string): string | null {
  const n = normalize(type, value);
  return n !== null && type === 'text' ? n.toLowerCase() : n;
}

/**
 * Can a value match not tell this field's paths apart? A yes/no field (any
 * field that is 1 or true on every proof page matches it), or one whose
 * proof pages all share one value. Text compares case-insensitively, as
 * `valuesEqual` does.
 */
export function isWeakField(type: CustomerFieldType, expectedValues: string[]): boolean {
  if (type === 'boolean') return true;
  if (expectedValues.length < 2) return false;
  const norms = new Set(expectedValues.map((v) => normalizeForWeak(type, v)));
  return norms.size === 1 && !norms.has(null);
}
