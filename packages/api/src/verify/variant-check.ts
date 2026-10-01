// packages/api/src/verify/variant-check.ts
// The variant part of every Verify run (spec 2026-10-01 §3/§4, variants plan
// 2 Task 4): certifies a website's variant list (list method) or its variant
// links plus one variant page per product (links method), and the hash that
// decides whether a stored result still describes the website as it stands.
// Free: no AI, no navigation — every page read here is a stored capture.
import type { IBrowser, PageCapture } from '@robot/browser';
import {
  certifyVariantList,
  certifyVariantLinks,
  variantHash,
  runVerifiedExtraction,
  normalize,
  normalizeVariantLink,
  type FieldVerification,
  type SchemaDefinitionField,
  type VariantPageResult,
  type VariantVerification,
  type VerificationSet,
  type VerifiedField,
} from '@robot/scraper';
import type { VariantSetup } from '../contract.js';
import { entryFieldsFor, variantNoun } from './variant-fields.js';
import { loadProofPageCaptures } from './proof-page-capture.js';

export type VariantsRequired = 'no' | 'setup-missing' | 'yes';

/** The failure a throw inside the variant check turns into: never a pass, never a failed field run. */
export const VARIANT_CHECK_FAILED = 'The variant check failed — try Verify again';
/** Every product with variants reads this when some field has no certified path this run (links method). */
export const VERIFY_EVERY_FIELD_FIRST = 'Verify every field first';

/**
 * Does this website need variant certification (Global Constraints)? Not
 * when its project ignores variants, nor when the website shows none;
 * blocked when the project wants variants but the website was never set up.
 */
export function variantsRequired(mode: string | null | undefined, setup: VariantSetup | null): VariantsRequired {
  if (!mode || mode === 'ignore') return 'no';
  if (!setup) return 'setup-missing';
  if (setup.method === 'none') return 'no';
  return 'yes';
}

/**
 * The hash a stored variant result must carry to still be current: the
 * method, the axis mapping, the answers for the present proof pages only,
 * and the entry fields' identity. Names are left out (renaming is free,
 * spec 4.3) — `variantHash` is typed on key/type/concept, so only those go in.
 */
export function currentVariantHash(args: { set: VerificationSet; setup: VariantSetup; datasetSchema: unknown }): string {
  const { set, setup, datasetSchema } = args;
  return variantHash({
    method: setup.method as 'list' | 'links',
    axes: setup.axes,
    urls: set.urls,
    answers: set.variants ?? {},
    fields: entryFieldsFor(datasetSchema, setup).map((f) => ({ key: f.key, type: f.type, concept: f.concept })),
  });
}

/**
 * Runs the variant check for one website. `captures` are the run's own
 * proof-page captures when the caller has them; otherwise the fresh
 * proof-page captures are loaded. `results` are this run's field results:
 * the links method's spot-check reads each variant page with exactly the
 * paths certified there.
 */
export async function runVariantCheck(
  args: {
    sourceId: string; set: VerificationSet; setup: VariantSetup; datasetSchema: unknown;
    fields: SchemaDefinitionField[]; results: Record<string, FieldVerification>;
    captures?: Record<string, PageCapture | null>;
  },
  deps: { browser: IBrowser },
): Promise<VariantVerification> {
  const { sourceId, set, setup, datasetSchema, fields, results } = args;
  const method = setup.method as 'list' | 'links';
  const hash = currentVariantHash({ set, setup, datasetSchema });
  const answers = set.variants ?? {};
  const noun = variantNoun(datasetSchema, setup);

  let captures: Record<string, PageCapture | null>;
  if (args.captures) {
    captures = Object.fromEntries(set.urls.map((u) => [u, args.captures![u] ?? null]));
  } else {
    const records = await loadProofPageCaptures(sourceId, set.urls);
    captures = Object.fromEntries(set.urls.map((u) => [u, records[u]?.capture ?? null]));
  }

  if (method === 'list') {
    const r = certifyVariantList({ urls: set.urls, captures, answers, fields: entryFieldsFor(datasetSchema, setup), noun });
    return { ...r, method, hash };
  }

  const r = await certifyVariantLinks(
    { urls: set.urls, captures, answers, noun },
    { evalScript: (html, script) => deps.browser.setContentEvaluate(html, script) },
  );
  const pages: Record<string, VariantPageResult> = { ...r.pages };

  // The spot-check: one variant page per product, read with this run's certified paths.
  const verified: VerifiedField[] = fields.map((f) => ({ key: f.key, type: f.type, concept: f.concept, paths: results[f.key]?.certified ?? [] }));
  const everyFieldCertified = verified.length > 0 && verified.every((f) => f.paths.length > 0);
  for (const [i, url] of set.urls.entries()) {
    const answer = answers[url];
    if (!answer || answer.count === 0 || pages[url]?.status !== 'pass') continue;
    if (!everyFieldCertified) { pages[url] = { status: 'fail', message: VERIFY_EVERY_FIELD_FIRST }; continue; }
    // Fail closed: a product with variants is never passed without its checked variant page.
    const spotUrl = answer.spot?.url;
    // Compared in the links' one normal form, so an answer stored with `#fragment` hrefs still finds its label.
    const linkIndex = spotUrl ? (answer.links ?? []).map(normalizeVariantLink).indexOf(normalizeVariantLink(spotUrl)) : -1;
    const label = (linkIndex >= 0 ? answer.labels[linkIndex] : undefined) ?? answer.labels[0] ?? 'variant';
    const spot = spotUrl ? (await loadProofPageCaptures(sourceId, [spotUrl]))[spotUrl] : undefined;
    if (!spotUrl || !spot) { pages[url] = { status: 'fail', message: `Take the ${label} page's screenshot again` }; continue; }
    const { data } = await runVerifiedExtraction({ url: spotUrl, fields: verified }, { browser: deps.browser, capture: spot.capture });
    // Only the fields this product is checked on: one left blank here is not required on its variant page either.
    const checked = fields.filter((f) => (set.expected[f.key]?.[url] ?? '').trim() !== '');
    const missing = checked.find((f) => normalize(f.type, data[f.key], { pageUrl: spotUrl }) === null);
    if (missing) pages[url] = { status: 'fail', message: `${missing.name} missing on the ${label} page of product ${i + 1}` };
  }

  const passed = !r.problem && Object.values(pages).every((p) => p.status !== 'fail' && p.status !== 'not_captured');
  return { ...r, pages, passed, method, hash };
}
