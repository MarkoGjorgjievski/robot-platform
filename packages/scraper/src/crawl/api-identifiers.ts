// Comparable identifiers, defined once.
//
// Detection asks "does this response carry the URLs page 1 produced?" and
// verification asks "did this probe return the SAME items as page 1?". Both are
// the same question about the same kind of value, so they share one definition —
// if they drifted apart, a config could pass detection and then be verified
// against a differently-shaped identifier, which is a bug with no symptom until
// a live site produces one.

/**
 * Short segments collide across unrelated payloads — "4", "en", "us" appear in
 * everything. An identifier has to be long enough that a coincidental match is
 * not the likely explanation. Same reasoning, and the same number, as
 * `MIN_IDENTIFIER_LENGTH` in `entity-match.ts`.
 *
 * It is NOT the same rule, though, and the difference is deliberate:
 * `entity-match.ts` additionally requires a digit, because it is hunting a
 * product identifier. Here a pure slug — `python-programming` — is a perfectly
 * good comparison key, and demanding a digit would blind detection to every
 * site whose detail URLs are words. Do not "align" the two by adding that test.
 */
const MIN_IDENTIFIER_LENGTH = 6;

/** Walk dot notation without throwing on a missing branch. */
export function getPath(obj: unknown, path: string): unknown {
  if (path === '') return obj;
  let current: unknown = obj;
  for (const key of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * The last meaningful path segment of a URL, or null when there isn't one.
 *
 * Deliberately path-only: an API returns "/p/12345" where the DOM carried
 * "https://site.example/p/12345", and detection compares one against the other.
 * Anchoring on the trailing segment makes those equal without needing to know
 * the origin.
 */
export function identifierFromUrl(url: string): string | null {
  let path: string;
  try {
    // Parsing gets the host out of the way for free — splitting the raw string
    // would leave "x.example" looking like a path segment, and a hostname is
    // long enough to pass the length bar and poison every comparison.
    path = new URL(url).pathname;
  } catch {
    // Not absolute: it is already a path like "/p/12345".
    path = url.split('?')[0]!.split('#')[0]!;
  }
  const segments = path.split('/').filter((s) => s.length > 0);
  const last = segments[segments.length - 1];
  if (!last || last.length < MIN_IDENTIFIER_LENGTH) return null;
  return last;
}

/**
 * Every identifier reachable at `itemsPath[].urlPath`, in order, skipping items
 * that have none.
 *
 * `limit`, when given, stops after that many items instead of walking the
 * whole array. Additive and defaulted so every existing caller is unchanged;
 * it exists for callers (like `findListingApi`) that must bound how much
 * synchronous work an arbitrarily large intercepted payload can cost them.
 */
export function collectFromJson(json: unknown, itemsPath: string, urlPath: string, limit?: number): string[] {
  const items = getPath(json, itemsPath);
  if (!Array.isArray(items)) return [];
  const count = limit === undefined ? items.length : Math.min(limit, items.length);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = getPath(items[i], urlPath);
    if (typeof raw !== 'string') continue;
    const id = identifierFromUrl(raw);
    if (id) out.push(id);
  }
  return out;
}
