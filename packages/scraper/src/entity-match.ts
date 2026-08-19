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
