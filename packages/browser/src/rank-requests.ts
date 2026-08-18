// Rank intercepted JSON responses so the most product-like one reaches AI
// analysis first.
//
// This is load-bearing: whatever ranks top is the document the model reads, and
// whatever it extracts from that document gets written to the domain cache. A
// mis-rank therefore does not just lose a field — it teaches the cache a wrong
// path. On 2026-08-18 a Newegg run ranked `ProductRelationInfoV3` — a
// related-products feed describing OTHER products — as the top source.
//
// Extracted from PlaywrightBrowser as a pure function so it can be tested against
// real captures without a live browser.
//
// Two scoring changes came with the extraction:
//
//   * URL matching is word-based, not substring. `url.includes('/price')` used to
//     fire on `/api/messages/pricing`.
//   * Body matching inspects PARSED KEYS, not raw text. `body.includes('"name"')`
//     could not tell the key `name` from the value `"name"`, so a config blob
//     listing field names scored as product data.
//
// The weights are e-commerce-tuned by design and will misjudge jobs/news/SaaS
// sources; pass `options.weights` to retune per vertical rather than forking.

import { isThirdPartyNoise } from './intercept-noise.js';
import type { InterceptedRequest } from './types.js';

/** Words in a URL path that suggest the endpoint serves the page's own entity. */
const PRODUCT_URL_WORDS = new Set([
  'product', 'products', 'item', 'items', 'listing', 'listings',
  'detail', 'details', 'pdp', 'catalog', 'sku', 'price', 'prices', 'search',
]);

/** Words that merely indicate "this is an API", a weak positive. */
const API_URL_WORDS = new Set(['api', 'graphql', 'v1', 'v2', 'v3', 'rest']);

/** Endpoints that exist but never describe the page's own entity. */
const NEGATIVE_URL_WORDS = new Set([
  'log', 'logs', 'logger', 'logevent', 'track', 'tracking', 'beacon',
  'telemetry', 'metrics', 'analytics', 'ping', 'collect',
  'auth', 'session', 'token', 'login', 'consent',
  'config', 'configs', 'configuration', 'flag', 'flags', 'feature', 'features',
]);

/**
 * Endpoints describing OTHER entities: recommendations, related items, sponsored
 * placements. These are the most dangerous mis-ranks precisely because their
 * payloads are product-shaped — they score well on every content signal while
 * being about the wrong product. Demoted hard rather than nudged.
 */
const RELATION_URL_WORDS = new Set([
  'relation', 'relations', 'related', 'relationinfo',
  'recommend', 'recommends', 'recommended', 'recommendation', 'recommendations',
  'similar', 'alsobought', 'alsoviewed', 'crosssell', 'upsell',
  'bestseller', 'bestsellers', 'sponsored', 'advertising', 'ads',
]);

/** Keys that suggest an object describes a sellable/reviewable entity. */
const PRODUCT_KEYS = new Set([
  'price', 'pricing', 'title', 'name', 'productname', 'description',
  'image', 'imageurl', 'images', 'rating', 'review', 'reviews', 'reviewcount',
  'sku', 'upc', 'gtin', 'mpn', 'brand', 'manufacturer', 'model',
  'availability', 'instock', 'stock', 'category', 'seller', 'shipping', 'currency',
]);

/** Keys that mark a payload as UI scaffolding or experiment config. */
const CONFIG_KEYS = new Set([
  'featureflags', 'experiments', 'modules', 'layout', 'zones',
  'components', 'template', 'templates', 'slots', 'placeholders',
]);

export const DEFAULT_WEIGHTS = {
  productUrlWord: 4,
  apiUrlWord: 2,
  negativeUrlWord: -10,
  /** Large enough to sink an otherwise perfect-looking product payload. */
  relationUrlWord: -30,
  productKey: 2,
  configKey: -4,
  sizeSweetSpot: 3,
  sizePlausible: 2,
  sizeOversized: -2,
};

export type RankWeights = typeof DEFAULT_WEIGHTS;

export type RankOptions = {
  weights?: Partial<RankWeights>;
  maxResults?: number;
};

/**
 * Guard rails for pathological payloads — deep nesting, cycles, huge arrays.
 *
 * The node cap was 5,000, and that silently truncated key discovery on exactly the
 * documents most worth scoring. Newegg's 62KB syndigo content blob carries
 * `description` and `image` keys, but the walk ran out of budget before reaching
 * them, so it scored 2 and ranked below a CSS theme file. Walking already-parsed
 * JSON is cheap; the cap only needs to bound pathological input, so it can be
 * generous.
 */
const MAX_KEY_DEPTH = 10;
const MAX_KEY_NODES = 50_000;

/**
 * A payload with almost no keys is an acknowledgement, not a data source. Four
 * copies of a 22-byte `{"success":true}` from `/api/v2/cookie_sent` scored 4 each
 * on their URL words alone and pushed real product content out of the top ten.
 */
const MIN_KEYS_FOR_DATA = 3;

/**
 * Split a URL's PATH into lowercase words, breaking on separators AND camelCase,
 * so `ProductRealtime` yields `product` + `realtime`.
 *
 * Word-level matching is the point: `pricing` must not count as `price`.
 *
 * The query string is deliberately excluded. Newegg's genuine product endpoint is
 * `/product/api/ProductRealtime?ItemNumber=…&RecommendItem=&BestSellerItemList=…`
 * — scoring the query made the parameter NAMES trip the relation penalty twice
 * and sank the one response we most wanted. A query parameter asking an endpoint
 * to also return recommendations does not make it a recommendations feed; the
 * path identifies the endpoint, the query only parameterises it.
 */
export function urlWords(url: string): Set<string> {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    // Not an absolute URL — fall back to scanning the whole string.
  }
  return new Set(
    path
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .split(/[^A-Za-z0-9]+/)
      .map((w) => w.toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Collect the KEY names present in a parsed JSON document.
 *
 * Keys only — the previous implementation searched the serialised body, which
 * could not distinguish the key `name` from a string value `"name"`.
 */
export function collectJsonKeys(value: unknown): Set<string> {
  const keys = new Set<string>();
  const seen = new WeakSet<object>();
  let nodes = 0;

  const walk = (v: unknown, depth: number): void => {
    if (v === null || typeof v !== 'object') return;
    if (depth > MAX_KEY_DEPTH || nodes > MAX_KEY_NODES) return;
    if (seen.has(v as object)) return;
    seen.add(v as object);
    nodes++;

    if (Array.isArray(v)) {
      for (const item of v) walk(item, depth + 1);
      return;
    }
    for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
      keys.add(k.toLowerCase());
      walk(child, depth + 1);
    }
  };

  walk(value, 0);
  return keys;
}

export function scoreRequest(r: InterceptedRequest, w: RankWeights = DEFAULT_WEIGHTS): number {
  let score = 0;

  const words = urlWords(r.url);
  for (const word of words) {
    if (RELATION_URL_WORDS.has(word)) score += w.relationUrlWord;
    else if (NEGATIVE_URL_WORDS.has(word)) score += w.negativeUrlWord;
    else if (PRODUCT_URL_WORDS.has(word)) score += w.productUrlWord;
    else if (API_URL_WORDS.has(word)) score += w.apiUrlWord;
  }

  const keys = collectJsonKeys(r.parsedJson);
  if (keys.size < MIN_KEYS_FOR_DATA) return 0;

  let productKeyHits = 0;
  for (const key of keys) {
    if (PRODUCT_KEYS.has(key)) { score += w.productKey; productKeyHits++; }
    else if (CONFIG_KEYS.has(key)) score += w.configKey;
  }

  // Size corroborates content, it is not evidence on its own. A 12KB CSS theme
  // file sits squarely in the "product-sized" band while describing nothing —
  // without this guard it scored 3 and outranked a 62KB product content blob.
  if (productKeyHits > 0) {
    if (r.bodySize > 2000 && r.bodySize < 50_000) score += w.sizeSweetSpot;
    else if (r.bodySize > 500 && r.bodySize < 100_000) score += w.sizePlausible;
    if (r.bodySize > 100_000) score += w.sizeOversized;
  }

  return score;
}

/**
 * Rank intercepted responses most-product-like first. Non-JSON, unparsed, and
 * known third-party noise are dropped outright, as is anything scoring <= 0.
 */
export function rankInterceptedRequests(
  requests: InterceptedRequest[],
  _pageUrl: string,
  options: RankOptions = {},
): InterceptedRequest[] {
  const weights = { ...DEFAULT_WEIGHTS, ...options.weights };
  const maxResults = options.maxResults ?? 10;

  return requests
    .filter((r) => r.isJson && r.parsedJson !== null)
    .filter((r) => !isThirdPartyNoise(r.url))
    .map((r) => ({ request: r, score: scoreRequest(r, weights) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map((s) => s.request);
}
