import type { StructuredData, InterceptedRequest } from '@robot/browser';

type FieldRequest = {
  name: string;
  type: string;
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
): { data: Record<string, unknown>; coverage: number; sources: Record<string, ExtractionSource> } {
  const data: Record<string, unknown> = {};
  const sources: Record<string, ExtractionSource> = {};

  // 1. Flatten API responses (highest priority)
  const apiFlat = flattenApiResponses(interceptedRequests ?? []);

  // 2. Flatten JSON-LD
  const ldFlat = flattenLdJson(structuredData.ldJson);

  // 3. Flatten meta tags
  const metaFlat = flattenMeta(structuredData.meta);

  // Try each source in priority order for each field
  for (const field of fields) {
    // Try API first
    let value = findFieldValue(field.name, field.type, apiFlat);
    if (value !== undefined && value !== null && value !== '') {
      data[field.name] = value;
      sources[field.name] = 'api';
      continue;
    }

    // Try JSON-LD
    value = findFieldValue(field.name, field.type, ldFlat);
    if (value !== undefined && value !== null && value !== '') {
      data[field.name] = value;
      sources[field.name] = 'json-ld';
      continue;
    }

    // Try meta tags
    value = findFieldValue(field.name, field.type, metaFlat);
    if (value !== undefined && value !== null && value !== '') {
      data[field.name] = value;
      sources[field.name] = 'meta';
    }
  }

  const coverage = fields.length > 0 ? Object.keys(data).length / fields.length : 0;

  return { data, coverage, sources };
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

function findFieldValue(
  fieldName: string,
  fieldType: string,
  allData: Record<string, unknown>,
): unknown {
  // Try exact match first
  if (isPrimitive(allData[fieldName])) return allData[fieldName];

  // Try known aliases
  const aliases = FIELD_ALIASES[fieldName] ?? [];
  for (const alias of aliases) {
    if (isPrimitive(allData[alias])) return allData[alias];
  }

  // Try fuzzy match (field name as substring)
  for (const [key, value] of Object.entries(allData)) {
    if (key.toLowerCase().includes(fieldName.toLowerCase()) && isPrimitive(value)) {
      return value;
    }
  }

  return undefined;
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
  const result: Record<string, unknown> = {};

  for (const req of requests) {
    if (!req.parsedJson || typeof req.parsedJson !== 'object') continue;

    // Deep flatten — go up to 8 levels to find primitive values
    deepFlatten(req.parsedJson as Record<string, unknown>, '', result, 0);
  }

  return result;
}

/**
 * Recursively flatten any JSON structure, extracting all primitive values
 * at every nesting level. Stores values at both full path and short key.
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
    // Also store at the leaf key name for easy lookup
    const leafKey = prefix.split('.').pop() ?? prefix;
    if (!result[leafKey]) result[leafKey] = obj;
    return;
  }

  if (Array.isArray(obj)) {
    // Store arrays of primitives
    if (obj.length > 0 && obj.every(v => typeof v === 'string' || typeof v === 'number')) {
      result[prefix] = obj;
      const leafKey = prefix.split('.').pop() ?? prefix;
      if (!result[leafKey]) result[leafKey] = obj;
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
      // Store primitives at both full path and short key
      result[fullKey] = value;
      if (!result[key]) result[key] = value;
    } else if (Array.isArray(value)) {
      // Only store arrays of primitives (e.g. image URLs)
      if (value.length > 0 && value.every(v => typeof v === 'string' || typeof v === 'number')) {
        result[fullKey] = value;
        if (!result[key]) result[key] = value;
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
