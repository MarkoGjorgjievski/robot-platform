// Derives a cache-bridge `concept`, a stable `key`, and the agent's
// `FieldType` vocabulary equivalent from a customer's plain-language field
// name and declared `CustomerFieldType`. Used when a customer schema
// definition (Task 1's `sources.schemaDefinition`) is turned into the
// internal shape the extraction chain and domain cache already understand.

import type { CustomerFieldType } from './types.js';

const ALIASES: Array<{ concept: string; patterns: RegExp[] }> = [
  { concept: 'price', patterns: [/\bprice\b/, /\bcost\b/, /\bmsrp\b/, /\brrp\b/] },
  { concept: 'product_name', patterns: [/^(product[_ ]?)?name$/, /^title$/, /\bproduct[_ ]?title\b/] },
  { concept: 'description', patterns: [/\bdescription\b/, /\bsummary\b/] },
  { concept: 'image_url', patterns: [/\bimage\b/, /\bphoto\b/, /\bpicture\b/] },
  { concept: 'brand', patterns: [/\bbrand\b/, /\bmanufacturer\b/] },
  { concept: 'sku', patterns: [/\bsku\b/, /\bitem[_ ]?(number|no|id)\b/, /\bmodel[_ ]?(number|no)\b/, /\bmpn\b/] },
  { concept: 'availability', patterns: [/\bavailab/, /\bin[_ ]?stock\b/, /\bstock\b/] },
  { concept: 'rating', patterns: [/\brating\b/, /\bstars?\b/] },
  { concept: 'review_count', patterns: [/\breview[_ ]?count\b/, /\breviews\b/] },
  { concept: 'currency', patterns: [/\bcurrency\b/] },
];

// Not exported — an unrelated `slugify` already lives in the api export
// module, and this name is generic enough to risk colliding with a future
// scraper export re-exported via `verify/index.ts`'s `export *`. Nothing
// outside this file needs it.
function slug(name: string): string {
  return name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export function deriveConcept(name: string, type: CustomerFieldType): string {
  const n = name.toLowerCase().replace(/[_-]+/g, ' ').trim();
  for (const { concept, patterns } of ALIASES) if (patterns.some((p) => p.test(n))) return concept;
  if (type === 'money') return 'price';
  if (type === 'image') return 'image_url';
  return slug(name) || 'field';
}

export function deriveKey(name: string, taken: Set<string>): string {
  const base = slug(name) || 'field';
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

export function customerTypeToFieldType(type: CustomerFieldType): string {
  switch (type) {
    case 'money': return 'price';
    case 'text': return 'string';
    case 'image': return 'image_url';
    case 'text_list': return 'array';
    default: return type;
  }
}
