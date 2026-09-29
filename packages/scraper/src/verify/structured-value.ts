// A raw structured value (API JSON, JSON-LD, meta) is sometimes an object —
// a JSON-LD ImageObject, `{ url }`, `{ contentUrl }`, `{ '@id' }` — rather
// than the scalar a field expects. One place reads it (spec 2026-09-29 C4):
// no cell result or shown value ever stores `[object Object]`; an object is
// read (its url/contentUrl/@id) or left out.

/** The URL a structured object names, if it has one: `url`, then `contentUrl`, then `@id`
 *  (JSON-LD ImageObject and friends) — the first of those that is itself a string. Not for
 *  an array or a non-object value: those are the caller's business. */
export function objectUrl(raw: unknown): string | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const candidate = obj.url ?? obj.contentUrl ?? obj['@id'];
  return typeof candidate === 'string' ? candidate : null;
}

/** A raw structured value fit to show the customer or compare as text (spec 2026-09-29 C4):
 *  a scalar prints as-is; an object reads `objectUrl` or is left out; an array joins its
 *  items' own display. Null when nothing displayable is in there — never `[object Object]`. */
export function displayValue(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  if (Array.isArray(raw)) {
    const items = raw.map(displayValue).filter((i): i is string => i !== null);
    return items.length ? items.join(', ') : null;
  }
  if (typeof raw === 'object') return objectUrl(raw);
  return null;
}
