// A website's binding (spec 4.2): where each contract field is on this
// website, the three to six proof pages, and the expected values. Name and
// type are never accepted here; they come from the contract.
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { VERIFY_URL_MIN, VERIFY_URL_MAX, normalize, validateExpected, type SchemaDefinitionField, type VerificationSet } from '@robot/scraper';
import { httpUrl } from './http-url.js';
import { bindingFor, type ContractField } from '../contract.js';

export const bindingInput = z.object({
  sourceId: z.string().uuid(),
  urls: z.array(httpUrl).min(VERIFY_URL_MIN).max(VERIFY_URL_MAX),
  listingUrl: httpUrl.optional(),
  descriptions: z.record(z.string(), z.string().trim().max(1000)),
  expected: z.record(z.string(), z.record(z.string(), z.string())),
});
export type BindingInput = z.infer<typeof bindingInput>;

/** Shared with `sources.setListingPages`/`setProductUrls` (task 3 fix round 1): the same-host comparison must use the same lowercasing everywhere. */
export const host = (u: string) => new URL(u).hostname.toLowerCase();

export function bindingProblems(input: Omit<BindingInput, 'sourceId'> & { sourceId?: string }, contract: ContractField[]): string[] {
  const problems: string[] = [];
  const hosts = new Set(input.urls.map(host));
  if (input.listingUrl) hosts.add(host(input.listingUrl));
  if (hosts.size > 1) problems.push('All URLs must be on the same website');
  if (new Set(input.urls.map((u) => normalize('url', u))).size !== input.urls.length) problems.push('URLs must be different pages');
  for (const f of contract) {
    if (!(input.descriptions[f.key] ?? '').trim()) problems.push(`${f.name}: say where it is on this website`);
    const cells = input.expected[f.key] ?? {};
    input.urls.forEach((url, i) => {
      const value = cells[url] ?? '';
      // Pages four to six: a blank cell means "not checked here" (spec 2026-09-17 §4).
      if (i >= VERIFY_URL_MIN && value.trim() === '') return;
      const err = validateExpected(f.type, value);
      if (err) problems.push(`${f.name} @ ${url}: ${err}`);
    });
  }
  input.urls.slice(VERIFY_URL_MIN).forEach((url) => {
    if (contract.every((f) => (input.expected[f.key]?.[url] ?? '').trim() === '')) problems.push(`${url}: type at least one expected value on this page, or remove it`);
  });
  return problems;
}

/** Throws BAD_REQUEST with the problem list; otherwise the binding rows and the verification set. */
export function prepareBinding(input: Omit<BindingInput, 'sourceId'> & { sourceId?: string }, contract: ContractField[]): { fields: SchemaDefinitionField[]; verificationSet: VerificationSet } {
  const problems = bindingProblems(input, contract);
  if (problems.length > 0) throw new TRPCError({ code: 'BAD_REQUEST', message: problems.join('\n') });
  const fields = bindingFor(contract, Object.fromEntries(contract.map((f) => [f.key, (input.descriptions[f.key] ?? '').trim()])));
  const expected: VerificationSet['expected'] = Object.fromEntries(contract.map((f) => [f.key, Object.fromEntries(input.urls.map((u) => [u, input.expected[f.key]?.[u] ?? '']))]));
  return { fields, verificationSet: { urls: input.urls, expected, ...(input.listingUrl ? { listing_url: input.listingUrl } : {}) } };
}
