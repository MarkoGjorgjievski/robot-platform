// Is this structured-data block about the page we actually asked for?
//
// A product page routinely carries structured data for things other than its own
// product: accessories, related items, whatever a client-side widget rendered
// last. Barnes & Noble, 2026-08-19 — the page is a $149.99 NOOK GlowLight 4
// e-reader and its only JSON-LD block describes a $9.99 case for it. Extraction
// took the case's price, availability, colour variants, feature list and URL, and
// every existing guard passed it:
//
//   * the shape validator sees a perfectly valid price
//   * page corroboration exempts json-ld — and would pass anyway, since the
//     case's price genuinely appears on the page
//   * request ranking does not apply; this is not an intercepted API
//   * the conflict detector needs two paths to disagree, and here one path
//     confidently returns one wrong answer
//
// The result is the worst shape a data error can take: internally consistent
// nonsense. A name from the right product and a price from the wrong one is
// harder to notice than either error alone.
//
// The discriminating signal is identifiers. Product URLs and structured data both
// carry them, and they are hard to get coincidentally right.

/** Product identifiers are long; slug words like "nook" or "4" are not. */
const MIN_IDENTIFIER_LENGTH = 6;

/** Keys on a structured-data node that carry an identifier or a self-link. */
const IDENTITY_KEYS = ['sku', 'gtin', 'gtin8', 'gtin12', 'gtin13', 'gtin14', 'mpn', 'productID', 'url'];

/**
 * Types that describe the page's own entity and therefore compete to be it.
 * Everything else — Organization, BreadcrumbList, WebSite — legitimately carries
 * unrelated identifiers and is never a candidate, so it is left alone.
 */
const ENTITY_TYPES = new Set(['product', 'productgroup', 'offer', 'book', 'vehicle', 'event', 'course']);

export type EntityMatch = { ok: true } | { ok: false; reason: string };

/**
 * Long alphanumeric tokens from a URL's path and query values — product ids,
 * SKUs, EANs. Short tokens are dropped: they are slug words, not identifiers,
 * and matching on them would make everything look related to everything.
 */
export function extractIdentifiers(url: string): Set<string> {
  const out = new Set<string>();
  let parts: string[] = [];
  try {
    const u = new URL(url);
    parts = [u.pathname, ...[...u.searchParams.values()]];
  } catch {
    parts = [url];
  }
  for (const part of parts) {
    for (const token of part.split(/[^A-Za-z0-9]+/)) {
      if (token.length >= MIN_IDENTIFIER_LENGTH && /\d/.test(token)) out.add(token.toLowerCase());
    }
  }
  return out;
}

/** Every identifier-ish string reachable in a structured-data node, shallowly. */
function entityIdentifiers(entity: Record<string, unknown>): Set<string> {
  const out = new Set<string>();

  const collect = (node: unknown, depth: number): void => {
    if (!node || typeof node !== 'object' || depth > 3) return;
    if (Array.isArray(node)) {
      for (const item of node) collect(item, depth + 1);
      return;
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (IDENTITY_KEYS.includes(key) && typeof value === 'string') {
        // A url contributes every identifier it contains; a bare sku is one token.
        if (key === 'url') for (const id of extractIdentifiers(value)) out.add(id);
        else if (value.length >= MIN_IDENTIFIER_LENGTH && /\d/.test(value)) out.add(value.toLowerCase());
      }
      collect(value, depth + 1);
    }
  };

  collect(entity, 0);
  return out;
}

function isEntityCandidate(entity: Record<string, unknown>): boolean {
  const raw = entity['@type'];
  const types = Array.isArray(raw) ? raw : [raw];
  return types.some((t) => typeof t === 'string' && ENTITY_TYPES.has(t.toLowerCase()));
}

/**
 * Decide whether a structured-data block describes the captured page's entity.
 *
 * Deliberately one-sided: it returns ok unless there is POSITIVE evidence of a
 * mismatch — both sides carry identifiers and they have none in common. Absence
 * of identifiers, an unrecognised type, or a malformed node all pass. Wrongly
 * discarding a page's only structured data would cost far more than the accessory
 * case it is here to catch, so the rule refuses to guess.
 */
export function describesSamePage(entity: unknown, pageUrl: string): EntityMatch {
  if (!entity || typeof entity !== 'object') return { ok: true };
  const node = entity as Record<string, unknown>;
  if (!isEntityCandidate(node)) return { ok: true };

  const pageIds = extractIdentifiers(pageUrl);
  if (pageIds.size === 0) return { ok: true };

  const entityIds = entityIdentifiers(node);
  if (entityIds.size === 0) return { ok: true };

  for (const id of entityIds) if (pageIds.has(id)) return { ok: true };

  const name = typeof node.name === 'string' ? ` ("${node.name.slice(0, 60)}")` : '';
  return {
    ok: false,
    reason: `identifier mismatch — block${name} carries [${[...entityIds].slice(0, 3).join(', ')}], page URL carries [${[...pageIds].slice(0, 3).join(', ')}]`,
  };
}

/**
 * ⚠ NOT WIRED INTO THE CHAIN — kept as a documented failed approach.
 *
 * The intent was sound: on Barnes & Noble the accessory data arrives through TWO
 * channels, and fixing the capture navigation left the other untouched — `sku`,
 * `description` and `variants` kept coming back as the $9.99 cover's, sourced
 * from `api` / `api-ai`, from a Shopify GraphQL response carrying the cover's
 * identifiers and none of the page's.
 *
 * **Why it cannot be used as written.** Comparing identifiers across API
 * namespaces produces false mismatches. Wired up, it dropped 8 of 10 Nike
 * responses — including the genuine product APIs — because Nike's URL carries
 * style codes (`pz28oX9z`, `CT8013`) while its APIs carry timestamps
 * (`1774411200000`), site ids (`850000`) and GTINs (`00198729253750`). None of
 * those overlap, and none of them should be expected to. B&N only worked because
 * its URL happens to carry the same EAN its API does; that is a coincidence of
 * one site, not a rule.
 *
 * **What a safe version needs.** Evidence that is comparable by construction — a
 * self-referential URL on the same host under a canonical/self key (`url`,
 * `canonicalUrl`, `pdpUrl`), the way schema.org's `offers.url` is. A bare numeric
 * token proves nothing about which entity a response describes. Until then the
 * JSON-LD filter stands alone, because schema.org's `sku`/`url` fields ARE
 * directly comparable to a product URL.
 *
 * Same one-sided rule as `describesSamePage`: a response is dropped only when it
 * carries identifiers AND the page carries identifiers AND they have none in
 * common. A response with no identifiers (a reviews feed, a config blob) has
 * offered no evidence and is kept.
 *
 * Coarse by design — it judges a whole response. A response containing the main
 * product *and* related items shares an identifier and is kept intact, so the
 * within-response scoping problem is untouched; that is `findEntitySubtree`'s
 * territory and a separate piece of work.
 */
export function filterRequestsForPage<T extends { url: string; parsedJson: unknown }>(
  requests: T[],
  pageUrl: string,
): T[] {
  const pageIds = extractIdentifiers(pageUrl);
  if (pageIds.size === 0) return requests;

  return requests.filter((request) => {
    const ids = jsonIdentifiers(request.parsedJson);
    if (ids.size === 0) return true;
    for (const id of ids) if (pageIds.has(id)) return true;
    console.log(
      `[extract] Ignoring API response about a different entity: ${request.url.slice(0, 80)}`
      + ` (carries [${[...ids].slice(0, 3).join(', ')}], page carries [${[...pageIds].slice(0, 3).join(', ')}])`,
    );
    return false;
  });
}

/**
 * Identifier-looking values anywhere in a parsed API response.
 *
 * Broader than the JSON-LD walk: an API is not schema.org, so identifiers hide
 * under any key name — `productId`, `handle`, `ean`, `itemNumber`. Rather than
 * guess the vocabulary, collect every long digit-bearing string or number and let
 * the overlap test decide. Bounded so a large payload cannot stall a capture.
 */
function jsonIdentifiers(value: unknown): Set<string> {
  const out = new Set<string>();
  const seen = new WeakSet<object>();
  let nodes = 0;

  const walk = (node: unknown, depth: number): void => {
    if (nodes > MAX_ID_NODES || depth > MAX_KEY_DEPTH) return;
    if (typeof node === 'string' || typeof node === 'number') {
      const token = String(node);
      if (token.length >= MIN_IDENTIFIER_LENGTH && token.length <= 32 && /^\d[\d-]*$/.test(token)) {
        out.add(token.toLowerCase());
      }
      return;
    }
    if (!node || typeof node !== 'object') return;
    if (seen.has(node as object)) return;
    seen.add(node as object);
    nodes++;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    for (const child of Object.values(node as Record<string, unknown>)) walk(child, depth + 1);
  };

  walk(value, 0);
  return out;
}

/** Bound on nodes visited when scanning an API response for identifiers. */
const MAX_ID_NODES = 20_000;
const MAX_KEY_DEPTH = 10;

/**
 * Drop structured-data entities that describe something other than this page.
 * Logs each rejection: silently discarding a site's structured data is exactly
 * the kind of thing that should be visible in a run log.
 */
export function filterEntitiesForPage<T>(entities: T[], pageUrl: string): T[] {
  return entities.filter((entity) => {
    const verdict = describesSamePage(entity, pageUrl);
    if (!verdict.ok) {
      console.log(`[extract] Ignoring structured data for a different entity: ${verdict.reason}`);
    }
    return verdict.ok;
  });
}
