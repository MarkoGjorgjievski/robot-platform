import type { StructuredData, InterceptedRequest } from '@robot/browser';

type FieldRequest = {
  name: string;
  type: string;
  description?: string;
  /** Source hint from AI discovery — controls which data source to try first */
  sourceHint?: 'api' | 'json-ld' | 'meta' | 'page';
};

type ExtractionSource = 'api' | 'api-ai' | 'json-ld' | 'meta' | 'xpath' | 'xpath-cached';

type FieldExtraction = {
  value: unknown;
  source: ExtractionSource;
  confidence: number;
};

/**
 * Extract data from all available structured sources:
 * 1. Intercepted API responses (highest priority — raw JSON from the server)
 * 2. JSON-LD (Schema.org structured data)
 * 3. Meta tags (og:, product:, twitter:)
 *
 * Returns extracted values with their source for transparency.
 */
export function extractFromStructuredData(
  structuredData: StructuredData,
  fields: FieldRequest[],
  interceptedRequests?: InterceptedRequest[],
): { data: Record<string, unknown>; coverage: number; sources: Record<string, ExtractionSource>; paths: Record<string, string> } {
  const data: Record<string, unknown> = {};
  const sources: Record<string, ExtractionSource> = {};
  const paths: Record<string, string> = {};

  // 1. Flatten API responses (highest priority)
  const apiFlat = flattenApiResponses(interceptedRequests ?? []);

  // 2. Flatten JSON-LD
  const ldFlat = flattenLdJson(structuredData.ldJson);

  // 3. Flatten meta tags
  const metaFlat = flattenMeta(structuredData.meta);

  // Source pools in default priority order
  const sourcePools: Array<{ key: ExtractionSource; data: Record<string, unknown> }> = [
    { key: 'api', data: apiFlat },
    { key: 'json-ld', data: ldFlat },
    { key: 'meta', data: metaFlat },
  ];

  for (const field of fields) {
    // If the AI told us where this field comes from, try that source first
    const ordered = field.sourceHint
      ? [
          ...sourcePools.filter(s => s.key === field.sourceHint),
          ...sourcePools.filter(s => s.key !== field.sourceHint),
        ]
      : sourcePools;

    for (const { key, data: pool } of ordered) {
      const match = findFieldValue(field.name, field.type, pool, field.description);
      if (match !== null) {
        data[field.name] = match.value;
        sources[field.name] = key;
        paths[field.name] = match.path;
        break;
      }
    }
  }

  const coverage = fields.length > 0 ? Object.keys(data).length / fields.length : 0;

  return { data, coverage, sources, paths };
}

// ─── Field name matching ─────────────────────────────────────────────────────

const FIELD_ALIASES: Record<string, string[]> = {
  product_name: ['name', 'title', 'productName', 'product_name', 'og:title', 'headline', 'item_name', 'product_title'],
  title: ['name', 'title', 'headline', 'og:title', 'item_name'],
  price: ['price', 'currentPrice', 'current_price', 'salePrice', 'sale_price', 'offers.price', 'product:price:amount', 'formatted_current_price', 'current_retail', 'min_price'],
  current_price: ['price', 'currentPrice', 'current_price', 'salePrice', 'sale_price', 'offers.price', 'product:price:amount', 'formatted_current_price', 'current_retail', 'min_price'],
  regular_price: ['regularPrice', 'regular_price', 'originalPrice', 'listPrice', 'offers.highPrice', 'formatted_comparison_price', 'reg_retail', 'msrp'],
  description: ['description', 'og:description', 'productDescription', 'product_description', 'soft_bullets', 'long_description'],
  product_description: ['description', 'og:description', 'productDescription', 'long_description', 'soft_bullets'],
  brand: ['brand', 'brand.name', 'manufacturer', 'brand_name', 'vendorName'],
  image_url: ['image', 'og:image', 'thumbnailUrl', 'thumbnail', 'primary_image_url', 'base_url', 'hero_image'],
  main_image_url: ['image', 'og:image', 'thumbnailUrl', 'primary_image_url', 'base_url', 'hero_image'],
  additional_images: ['images', 'alternate_image_urls', 'image_urls', 'gallery'],
  rating: ['aggregateRating.ratingValue', 'ratingValue', 'rating', 'average_overall_rating', 'overall_rating', 'stars'],
  review_count: ['aggregateRating.reviewCount', 'reviewCount', 'review_count', 'ratingCount', 'total_review_count', 'num_reviews'],
  availability: ['offers.availability', 'availability', 'availability_status', 'in_stock', 'is_available'],
  sku: ['sku', 'productID', 'mpn', 'gtin', 'gtin13', 'tcin', 'item_id', 'product_id', 'asin'],
  url: ['url', 'og:url', 'canonical_url', 'product_url'],
  category: ['category', 'product:category', 'category_name', 'department', 'breadcrumb'],
  currency: ['offers.priceCurrency', 'priceCurrency', 'product:price:currency', 'currency_code'],
  seller: ['offers.seller.name', 'seller', 'vendor', 'vendorName', 'sold_by', 'marketplace_seller'],
  discount_amount: ['discount', 'savings', 'discount_amount', 'save_amount', 'eyebrow'],
  discount_percentage: ['discountPercentage', 'discount_percentage', 'save_percentage', 'percent_off'],
  shipping_info: ['shipping', 'shipping_info', 'delivery', 'delivery_info', 'fulfillment'],
  product_dimensions: ['dimensions', 'product_dimensions', 'size'],
  product_features: ['features', 'product_features', 'highlights', 'bullet_descriptions', 'soft_bullets'],
};

type FieldMatch = { value: unknown; path: string };

/** Count path depth (fewer dots = shallower = more likely product data) */
function pathDepth(path: string): number {
  return path.split('.').length + (path.split('[').length - 1);
}

/** From a list of candidates, return the shallowest (least nested) match */
function shallowest(candidates: FieldMatch[]): FieldMatch | null {
  if (candidates.length === 0) return null;
  return candidates.reduce((best, c) => pathDepth(c.path) < pathDepth(best.path) ? c : best);
}

function findFieldValue(
  fieldName: string,
  fieldType: string,
  allData: Record<string, unknown>,
  _description?: string,
): FieldMatch | null {
  // Try exact match first (top-level key or full path)
  if (isPrimitive(allData[fieldName])) return { value: allData[fieldName], path: fieldName };

  // Try known aliases — exact key match
  const aliases = FIELD_ALIASES[fieldName] ?? [];
  for (const alias of aliases) {
    if (isPrimitive(allData[alias])) return { value: allData[alias], path: alias };
  }

  // Try aliases as path suffixes — collect ALL matches, pick shallowest
  // e.g., alias "name" matches both "product.name" (depth 2) and "chat.ui.widget.name" (depth 4)
  // We want "product.name"
  const aliasCandidates: FieldMatch[] = [];
  for (const alias of aliases) {
    const suffix = '.' + alias;
    for (const [key, value] of Object.entries(allData)) {
      if (key.endsWith(suffix) && isPrimitive(value)) {
        aliasCandidates.push({ value, path: key });
      }
    }
  }
  const bestAlias = shallowest(aliasCandidates);
  if (bestAlias) return bestAlias;

  // Try field name as path suffix — collect ALL, pick shallowest
  const fieldSuffix = '.' + fieldName;
  const fieldCandidates: FieldMatch[] = [];
  for (const [key, value] of Object.entries(allData)) {
    if (key.endsWith(fieldSuffix) && isPrimitive(value)) {
      fieldCandidates.push({ value, path: key });
    }
  }
  const bestField = shallowest(fieldCandidates);
  if (bestField) return bestField;

  // No fuzzy matching — it causes too many false positives on complex APIs.
  // If suffix matching can't find it, let the AI extraction steps handle it.
  return null;
}

function isPrimitive(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') return true;
  // Allow simple string arrays (e.g. image URLs)
  if (Array.isArray(value) && value.length > 0 && value.every(v => typeof v === 'string')) return true;
  return false;
}

// ─── Flatteners ──────────────────────────────────────────────────────────────

function flattenApiResponses(requests: InterceptedRequest[]): Record<string, unknown> {
  // Deduplicate by URL and separate product-like APIs from config/translation blobs
  const seen = new Set<string>();
  const productApis: InterceptedRequest[] = [];
  const otherApis: InterceptedRequest[] = [];

  for (const req of requests) {
    if (!req.parsedJson || typeof req.parsedJson === 'string') continue;
    if (seen.has(req.url)) continue;
    seen.add(req.url);

    const urlLower = req.url.toLowerCase();
    const isLikelyConfig = urlLower.includes('translation') || urlLower.includes('localisation')
      || urlLower.includes('config') || urlLower.includes('feature-flag')
      || urlLower.includes('analytics') || urlLower.includes('tracking')
      || (req.bodySize ?? 0) > 20000;

    if (isLikelyConfig) {
      otherApis.push(req);
    } else {
      productApis.push(req);
    }
  }

  // Only flatten product-like APIs — config/translation blobs cause false matches.
  // The AI extraction steps handle anything mechanical can't find.
  const result: Record<string, unknown> = {};
  for (const req of productApis) {
    deepFlatten(req.parsedJson as Record<string, unknown>, '', result, 0);
  }

  return result;
}

/**
 * Recursively flatten any JSON structure, extracting all primitive values
 * at every nesting level. Stores values at full dot-notation paths only
 * to avoid collisions between unrelated fields sharing the same leaf key.
 */
function deepFlatten(
  obj: unknown,
  prefix: string,
  result: Record<string, unknown>,
  depth: number,
): void {
  if (depth > 8 || obj === null || obj === undefined) return;

  if (typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean') {
    result[prefix] = obj;
    return;
  }

  if (Array.isArray(obj)) {
    // Store arrays of primitives
    if (obj.length > 0 && obj.every(v => typeof v === 'string' || typeof v === 'number')) {
      result[prefix] = obj;
    }
    // Recurse into first few items of arrays of objects
    for (let i = 0; i < Math.min(obj.length, 3); i++) {
      if (typeof obj[i] === 'object' && obj[i] !== null) {
        deepFlatten(obj[i], `${prefix}[${i}]`, result, depth + 1);
      }
    }
    return;
  }

  if (typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      deepFlatten(value, fullKey, result, depth + 1);
    }
  }
}

function flattenLdJson(ldJson: Record<string, unknown>[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const obj of ldJson) {
    flattenObject(obj, '', result);
  }

  return result;
}

function flattenMeta(meta: Record<string, string>): Record<string, unknown> {
  return { ...meta };
}

function flattenObject(
  obj: Record<string, unknown>,
  prefix: string,
  result: Record<string, unknown>,
  depth = 0,
): void {
  if (depth > 4) return;

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;

    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      result[fullKey] = value;
    } else if (Array.isArray(value)) {
      // Only store arrays of primitives (e.g. image URLs)
      if (value.length > 0 && value.every(v => typeof v === 'string' || typeof v === 'number')) {
        result[fullKey] = value;
      }
      // If array of objects, flatten the first one for field discovery
      if (value.length > 0 && typeof value[0] === 'object' && value[0] !== null) {
        flattenObject(value[0] as Record<string, unknown>, fullKey, result, depth + 1);
      }
    } else if (typeof value === 'object') {
      // Recurse into nested objects
      flattenObject(value as Record<string, unknown>, fullKey, result, depth + 1);
    }
  }
}
