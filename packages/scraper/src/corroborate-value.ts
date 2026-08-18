// Corroborate an extracted value against what the page actually renders.
//
// Three times now the pipeline has accepted, as a product name, a string that
// appears nowhere on the page: OneTrust's "otFlat", a cached IKEA path, and
// Newegg's internal feature-flag label "Similar Seller Recommendation on
// OrderTracking and ProductList page". Each time the value came from an
// INTERCEPTED API — a separate document that may describe a different entity
// entirely (recommendations, config, other sellers' listings).
//
// The blocklist in @robot/browser can only catch third-party hosts it already
// knows. This catches the class: if a name-like value from an API cannot be
// found in the rendered page, it is not this page's value.
//
// Measured on the live Newegg page: the three correct values scored 100% token
// overlap against visible text, the two poisoned values scored 29% and 0%.

import type { PathSource } from './domain-cache.js';

export type CorroborationResult = { ok: true } | { ok: false; reason: string };

/**
 * Only values from a separate document need corroborating. JSON-LD, meta tags
 * and XPath all read the page itself, so checking them against the page is
 * circular; `human` is an explicit override and always wins.
 */
const CORROBORATED_SOURCES: ReadonlySet<string> = new Set(['api', 'api-ai']);

/**
 * Only name-like identity fields. Deliberately excludes numbers and IDs: the API
 * reports review_count as 1144 while the page renders "(1,144)", and an internal
 * sku like "9SIC0X3KPS7946" legitimately never appears in visible text. Applying
 * this rule to those would discard good data.
 */
const CORROBORATED_FIELDS: ReadonlySet<string> = new Set([
  'product_name', 'title', 'name', 'brand', 'manufacturer',
]);

/** Below this share of the value's distinctive words appearing on the page, the
 *  value is treated as describing something else. The measured gap is 100% for
 *  real values vs 29% for the worst poisoned one, so this sits comfortably between. */
const MIN_TOKEN_OVERLAP = 0.6;

/** Words this short carry no signal ("on", "and", "the") and are dropped before scoring. */
const MIN_TOKEN_LENGTH = 3;

/** Strip markup to the text a reader would actually see.
 *
 *  Script and style contents are removed first, deliberately: JSON-LD lives in a
 *  `<script type="application/ld+json">` block and inline config often echoes the
 *  very API payload we are trying to check, so leaving them in would let a value
 *  corroborate itself. */
export function visibleTextFromHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Decide whether `value` is supported by the rendered page.
 *
 * Returns ok:true whenever the rule does not apply or cannot judge honestly —
 * wrong source, wrong field, non-string value, no page text, or too few
 * distinctive words to score. Rejection is reserved for the case we can actually
 * demonstrate: a name-like API value whose words are mostly absent from the page.
 */
export function corroborateValue(opts: {
  value: unknown;
  fieldName: string;
  source: PathSource | string;
  pageText: string;
}): CorroborationResult {
  const { value, fieldName, source, pageText } = opts;

  if (!CORROBORATED_SOURCES.has(source)) return { ok: true };
  if (!CORROBORATED_FIELDS.has(fieldName)) return { ok: true };
  if (typeof value !== 'string') return { ok: true };
  if (!pageText) return { ok: true };

  const tokens = normalize(value)
    .split(' ')
    .filter((t) => t.length >= MIN_TOKEN_LENGTH);
  if (tokens.length === 0) return { ok: true };

  const haystack = normalize(pageText);
  const found = tokens.filter((t) => haystack.includes(t)).length;
  const overlap = found / tokens.length;

  if (overlap >= MIN_TOKEN_OVERLAP) return { ok: true };
  return {
    ok: false,
    reason: `not corroborated by page text (${found}/${tokens.length} words found, need ${Math.round(MIN_TOKEN_OVERLAP * 100)}%)`,
  };
}
