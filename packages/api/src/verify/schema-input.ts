// Customer-defined schema input: the Zod shape a "Create with schema"/"Edit
// schema" form submits, plus the pure normalization that turns it into the
// `sources.schemaDefinition` + `sources.verificationSet` shape (Task 1's
// columns). Kept separate from sources.ts so `prepareSchema`/`schemaProblems`
// are unit-testable without a database.

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import {
  CUSTOMER_FIELD_TYPES,
  VERIFY_URL_COUNT,
  DETAIL_URL_FIELD,
  deriveConcept,
  deriveKey,
  normalize,
  validateExpected,
  type SchemaDefinitionField,
  type VerificationSet,
} from '@robot/scraper';

/**
 * `z.string().url()` alone accepts any scheme WHATWG's URL parser
 * recognizes — `file://`, `javascript:`, `data:`, ... — any of which
 * `findProductPages` would happily hand to `withBrowserSession` for
 * `browser.capture()` to navigate to. Shared by every URL field a browser
 * might visit: the schema wizard's three verification URLs, its optional
 * listing URL, and `findProductPages`'s own `listingUrl` input.
 */
export const httpUrl = z.string().url().refine((u) => {
  // `.url()` above is a non-fatal check in zod — a malformed string (one that
  // already fails `.url()`) still reaches this refine, and `new URL()` on it
  // throws rather than returning a comparable `.protocol`. Guarded so that
  // case surfaces as `.url()`'s own "Invalid url" issue, not an unhandled
  // TypeError escaping the whole parse.
  try {
    return /^https?:$/.test(new URL(u).protocol);
  } catch {
    return false;
  }
}, {
  message: 'Only http(s) URLs are allowed',
});

export const customerFieldInput = z.object({
  key: z.string().optional(),
  name: z.string().trim().min(1).max(100),
  type: z.enum(CUSTOMER_FIELD_TYPES),
  description: z.string().trim().min(1).max(1000),
});
export const schemaInput = z.object({
  urls: z.array(httpUrl).length(VERIFY_URL_COUNT),
  listingUrl: httpUrl.optional(),
  fields: z.array(customerFieldInput).min(1).max(100),
  expected: z.record(z.string(), z.record(z.string(), z.string())), // fieldKey|name → url → value
});
export type SchemaInput = z.infer<typeof schemaInput>;

const host = (u: string) => new URL(u).hostname.toLowerCase();

/**
 * Looks up a field's expected-value cells by key first (when a non-empty key
 * was supplied), falling back to its name — never by indexing `expected['']`,
 * which an absent/blank key would otherwise do (`f.key ?? ''`), and which
 * could accidentally match a stray `''` entry in `expected`.
 */
function expectedCellsFor(input: SchemaInput, f: z.infer<typeof customerFieldInput>): Record<string, string> {
  return (f.key ? input.expected[f.key] : undefined) ?? input.expected[f.name] ?? {};
}

export function schemaProblems(input: SchemaInput): string[] {
  const problems: string[] = [];
  const hosts = new Set(input.urls.map(host));
  if (input.listingUrl) hosts.add(host(input.listingUrl));
  if (hosts.size > 1) problems.push('All URLs must be on the same website');
  const canonical = new Set(input.urls.map((u) => normalize('url', u)));
  if (canonical.size !== input.urls.length) problems.push('URLs must be different pages');
  const names = new Set<string>();
  for (const f of input.fields) {
    const lower = f.name.toLowerCase();
    if (names.has(lower)) problems.push(`Duplicate field name: ${f.name}`);
    names.add(lower);
    // Controller ruling: a field whose derived key would be the reserved
    // planning key `detail_url` (`@robot/scraper`'s `DETAIL_URL_FIELD`) is
    // rejected — keeps the customer branch of `effectiveSchema` free of the
    // listing-crawl planning sentinel.
    const candidateKey = f.key && f.key.trim() !== '' ? f.key : deriveKey(f.name, new Set());
    if (candidateKey === DETAIL_URL_FIELD) problems.push(`${f.name}: field name is reserved`);
    const cells = expectedCellsFor(input, f);
    for (const url of input.urls) {
      const err = validateExpected(f.type, cells[url] ?? '');
      if (err) problems.push(`${f.name} @ ${url}: ${err}`);
    }
  }
  return problems;
}

/** Assigns keys/concepts, validates hostnames + expected values; throws TRPCError BAD_REQUEST with a per-cell problem list. */
export function prepareSchema(
  input: SchemaInput,
  existing: SchemaDefinitionField[] = [],
): { fields: SchemaDefinitionField[]; verificationSet: VerificationSet; hostname: string } {
  const problems = schemaProblems(input);
  if (problems.length > 0) throw new TRPCError({ code: 'BAD_REQUEST', message: problems.join('\n') });
  const byKey = new Map(existing.map((f) => [f.key, f]));

  // I6: `taken` must start out holding every PRESERVED key, not fill up as
  // the loop goes. A preserved key is not derived, so it never passed
  // through `deriveKey`'s uniqueness check — and a new field earlier in the
  // list derives against a `taken` that does not know about it yet. Adding
  // "Price!" alongside an existing `price` field used to mint a second
  // `price` key: two schema fields with one key, one clobbering the other's
  // `expected` cells and its verification results.
  const taken = new Set<string>(
    input.fields.map((f) => (f.key ? byKey.get(f.key)?.key : undefined)).filter((k): k is string => !!k),
  );

  const fields: SchemaDefinitionField[] = [];
  const expected: VerificationSet['expected'] = {};
  for (const f of input.fields) {
    const prior = f.key ? byKey.get(f.key) : undefined;
    const key = prior ? prior.key : deriveKey(f.name, taken);
    taken.add(key);
    fields.push({ key, name: f.name, type: f.type, description: f.description, concept: prior?.concept ?? deriveConcept(f.name, f.type) });
    const cells = expectedCellsFor(input, f);
    expected[key] = Object.fromEntries(input.urls.map((u) => [u, cells[u] ?? '']));
  }

  // Defensive: a collision that survives the pre-seeding above would be
  // silent data loss (`expected[key]` overwritten, one field's results
  // reported as the other's), so it fails loudly here instead.
  const keys = fields.map((f) => f.key);
  if (new Set(keys).size !== fields.length) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `Field keys collide: ${keys.join(', ')}` });
  }

  return { fields, verificationSet: { urls: input.urls, expected, ...(input.listingUrl ? { listing_url: input.listingUrl } : {}) }, hostname: host(input.urls[0]!) };
}
