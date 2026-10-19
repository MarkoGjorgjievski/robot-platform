// A website's binding (spec 4.2): where each contract field is on this
// website, the three to six proof pages, and the expected values. Name and
// type are never accepted here; they come from the contract.
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { VERIFY_URL_MIN, VERIFY_URL_MAX, afterLabel, labelled, normalize, validateExpected, valuesEqual, type SchemaDefinitionField, type VerificationSet } from '@robot/scraper';
import { httpUrl } from './http-url.js';
import { bindingFor, type ContractField } from '../contract.js';

const rect = z.object({ x: z.number().min(0), y: z.number().min(0), w: z.number().min(0), h: z.number().min(0) });
export const markInput = z.object({ xpaths: z.array(z.string().max(2000)).min(1).max(3), text: z.string().max(2000), rect });
export const confirmedPathInput = z.object({ source: z.enum(['api', 'json-ld', 'meta']), path: z.string().max(2000) });
const card = z.object({ url: httpUrl, title: z.string().max(300), image: httpUrl.optional() });

export const bindingInput = z.object({
  sourceId: z.string().uuid(),
  urls: z.array(httpUrl).min(VERIFY_URL_MIN).max(VERIFY_URL_MAX),
  listingUrl: httpUrl.optional(),
  descriptions: z.record(z.string(), z.string().trim().max(1000)),
  expected: z.record(z.string(), z.record(z.string(), z.string())),
  /** fieldKey → url → the element the customer clicked (spec 2026-09-18 §3.5). */
  marks: z.record(z.string(), z.record(z.string(), markInput)).optional(),
  /** fieldKey → url → the structured path the answer was accepted from (spec 2026-09-29 §2 C1). */
  paths: z.record(z.string(), z.record(z.string(), confirmedPathInput)).optional(),
  /** Autosave from the Verification tab: the per-cell completeness rules wait for Verify (spec 2026-09-25 §3). */
  draft: z.boolean().optional(),
  cards: z.array(card).max(VERIFY_URL_MAX).optional(),
  /** fieldKey → url → "not on this product", a checked page whose answer is nothing (spec 2026-10-10 §B1). */
  absent: z.record(z.string(), z.record(z.string(), z.literal(true))).optional(),
  /** fieldKey → the website's default for that field (spec 2026-10-13 §3): a run writes it where every certified path misses. */
  defaults: z.record(z.string(), z.string().max(2000)).optional(),
});
export type BindingInput = z.infer<typeof bindingInput>;

/** Shared with `sources.setListingPages`/`setProductUrls` (task 3 fix round 1): the same-host comparison must use the same lowercasing everywhere. */
export const host = (u: string) => new URL(u).hostname.toLowerCase();

export function bindingProblems(input: Omit<BindingInput, 'sourceId'> & { sourceId?: string }, contract: ContractField[], opts: { draft?: boolean } = {}): string[] {
  const draft = opts.draft ?? input.draft ?? false;
  const problems: string[] = [];
  const hosts = new Set(input.urls.map(host));
  if (input.listingUrl) hosts.add(host(input.listingUrl));
  if (hosts.size > 1) problems.push('All URLs must be on the same website');
  if (new Set(input.urls.map((u) => normalize('url', u))).size !== input.urls.length) problems.push('URLs must be different pages');
  for (const f of contract) {
    if (!draft && !(input.descriptions[f.key] ?? '').trim()) problems.push(`${f.name}: say where it is on this website`);
    const cells = input.expected[f.key] ?? {};
    const absent = input.absent?.[f.key] ?? {};
    const def = (input.defaults?.[f.key] ?? '').trim();
    if (def) {
      const err = validateExpected(f.type, def);
      if (err) problems.push(`${f.name}: default — ${err}`);
      // A default would fill the very cell the customer said is empty (spec 2026-10-13 §3).
      if (Object.keys(absent).length > 0) problems.push(`${f.name}: a default and "not on this product" cannot both be set`);
    }
    input.urls.forEach((url, i) => {
      const value = cells[url] ?? '';
      if (absent[url] && value.trim() !== '') { problems.push(`${f.name} @ ${url}: a value and "not on this product" cannot both be set`); return; }
      if (absent[url]) return;                                         // a checked page where the answer is nothing
      // Pages four to six: a blank cell means "not checked here" (spec 2026-09-17 §4).
      // A draft save (Verification tab autosave) can leave any cell blank — Verify checks completeness itself.
      // A field with a default: a blank cell on any page is a default cell (spec 2026-10-13 §3).
      if ((draft || i >= VERIFY_URL_MIN || def) && value.trim() === '') return;
      const err = validateExpected(f.type, value);
      if (err) problems.push(`${f.name} @ ${url}: ${err}`);
    });
    for (const url of input.urls) {
      // A mark on a checked-absent page isn't a problem — "not on this product" drops the mark (spec 2026-10-10 §B1), it doesn't need one.
      if (input.marks?.[f.key]?.[url] && !absent[url] && (cells[url] ?? '').trim() === '') problems.push(`${f.name} @ ${url}: a marked element needs its value`);
    }
    if (!draft) {
      // A field marked "not on this product" anywhere must still have a value on at least two
      // products (spec 2026-10-10 §B1) — otherwise there is nothing to cross-validate against.
      const withValue = input.urls.filter((url) => (cells[url] ?? '').trim() !== '').length;
      const absentCount = input.urls.filter((url) => absent[url]).length;
      if (absentCount > 0 && withValue < 2) problems.push(`${f.name}: needs a value on at least two products`);
    }
  }
  if (!draft) {
    input.urls.slice(VERIFY_URL_MIN).forEach((url) => {
      if (contract.every((f) => (input.expected[f.key]?.[url] ?? '').trim() === '' && !input.absent?.[f.key]?.[url])) problems.push(`${url}: type at least one expected value on this page, or remove it`);
    });
  }
  return problems;
}

/** Throws BAD_REQUEST with the problem list; otherwise the binding rows and the verification set. */
export function prepareBinding(input: Omit<BindingInput, 'sourceId'> & { sourceId?: string }, contract: ContractField[]): { fields: SchemaDefinitionField[]; verificationSet: VerificationSet } {
  const problems = bindingProblems(input, contract);
  if (problems.length > 0) throw new TRPCError({ code: 'BAD_REQUEST', message: problems.join('\n') });
  const fields = bindingFor(contract, Object.fromEntries(contract.map((f) => [f.key, (input.descriptions[f.key] ?? '').trim()])));
  const expected: VerificationSet['expected'] = Object.fromEntries(contract.map((f) => [f.key, Object.fromEntries(input.urls.map((u) => [u, input.expected[f.key]?.[u] ?? '']))]));
  const marks: NonNullable<VerificationSet['marks']> = {};
  for (const f of contract) {
    // A mark always carries its value (spec 2026-09-18 §3.5): the proof sheet's Import values can
    // rewrite a cell while a client is round-tripping the mark that was on the old one, and a mark
    // pointing at the wrong element would then join certification's candidates. Image and link marks
    // carry their value in `src`/`href`, not text, so there is nothing to compare and they are kept.
    const current = (u: string) => {
      const mark = input.marks?.[f.key]?.[u];
      if (!mark) return false;
      if (input.absent?.[f.key]?.[u]) return false; // "not on this product" drops the mark (spec 2026-10-10 §B1), even an image/link mark with no text to compare
      const value = expected[f.key]![u] ?? '';
      // A labelled concept's mark may read "Style: 398846_01" for the value 398846_01 (spec 2026-10-17 §6); a title never.
      const after = labelled(f.concept) ? afterLabel(mark.text) : null;
      return mark.text.trim() === '' || valuesEqual(f.type, mark.text, value, { pageUrl: u }) || (after !== null && valuesEqual(f.type, after, value, { pageUrl: u }));
    };
    const perUrl = Object.fromEntries(input.urls.filter(current).map((u) => [u, input.marks![f.key]![u]!]));
    if (Object.keys(perUrl).length) marks[f.key] = perUrl;
  }
  const paths: NonNullable<VerificationSet['paths']> = {};
  for (const f of contract) {
    const perUrl = Object.fromEntries(
      input.urls.filter((u) => input.paths?.[f.key]?.[u] && (expected[f.key]![u] ?? '').trim() !== '').map((u) => [u, input.paths![f.key]![u]!])
    );
    if (Object.keys(perUrl).length) paths[f.key] = perUrl;
  }
  const cards = input.cards?.filter((c) => input.urls.includes(c.url));
  const absent: NonNullable<VerificationSet['absent']> = {};
  for (const f of contract) {
    const perUrl = Object.fromEntries(input.urls.filter((u) => input.absent?.[f.key]?.[u]).map((u) => [u, true as const]));
    if (Object.keys(perUrl).length) absent[f.key] = perUrl;
  }
  const defaults: NonNullable<VerificationSet['defaults']> = {};
  for (const f of contract) {
    const def = (input.defaults?.[f.key] ?? '').trim();
    if (def) defaults[f.key] = def;
  }
  // `BindingInput` carries no `variants` field — the fields' autosave never answers for a
  // website's variants — so this never emits one; `sources.updateBinding` (plan 2 task 3) carries
  // the prior `verificationSet.variants` forward itself, under a row lock, right before its write.
  return {
    fields,
    verificationSet: {
      urls: input.urls,
      expected,
      ...(input.listingUrl ? { listing_url: input.listingUrl } : {}),
      ...(Object.keys(marks).length ? { marks } : {}),
      ...(Object.keys(paths).length ? { paths } : {}),
      ...(cards?.length ? { cards } : {}),
      ...(Object.keys(absent).length ? { absent } : {}),
      ...(Object.keys(defaults).length ? { defaults } : {}),
    },
  };
}
