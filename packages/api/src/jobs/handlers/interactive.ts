// packages/api/src/jobs/handlers/interactive.ts
// The bodies of the procedures that answered from a browser while the request waited — the listing
// check, the reachability line, mark transfer, variant detection, "links near" — moved here unchanged
// from routers/sources.ts (after each one's org check, which stays in the router). The worker runs
// them as interactive jobs; the api-server waits for the answer (spec 2026-10-23 §4.4). The host
// backoff after a wall (`backoffAnswer` / `reportVerdict`) lives in the process that loads pages: the worker.
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { db, sources } from '@robot/db';
import {
  transferMarks, buildDomSearchScript, buildXPathProbeScript,
  detectVariantLists, buildVariantLinksScript, buildVariantPickerScript, buildLinksNearScript,
  type SchemaDefinitionField, type VerificationSet, type Transferred, type DomHit, type DomNeedle, type XPathProbeResult,
  type VariantList, type VariantLinks, type VariantPicker,
  reportVerdict, backoffAnswer, CaptureProblemError, readListingPage,
} from '@robot/scraper';
import { CaptureError, BROWSER_UNAVAILABLE } from '@robot/browser';
import { withBrowserSession } from '../../browser-session.js';
import { forWebsite } from '../../proxy/website-session.js';
import { describeListingPage, unreadListingPage, type ListingPageCheck } from '../../verify/find-product-pages.js';
import { reachabilityResult, type Reachability } from '../../verify/reachability.js';
import { loadProofPageCaptures } from '../../verify/proof-page-capture.js';
import type { TransferMarksPayload } from '../types.js';

/**
 * The Extract tab's per-row listing check — no AI, nothing saved, one page
 * load. Reads the page with `readListingPage` (@robot/scraper: loaded
 * more, at most three rounds; its links read in the live page) and hands
 * them to `describeListingPage` (find-product-pages.ts): the product
 * group's full size, a sample of it, and whether a pager was detected on
 * the page.
 *
 * Carries the capture's verdict (spec 2026-10-09 §A1): a block page,
 * CAPTCHA or 404 counts no links and says why in `message` (null when ok);
 * no document at all (a `CaptureError`) reads the same way. The verdict
 * also feeds the host's backoff (`reportVerdict`).
 *
 * A host still backing off after a wall is answered from the backoff, with
 * no browser: the wall's sentence and how long the wait still is (review
 * I4, 2026-10-09). Loading it again would only extend the wall.
 *
 * Runs in the worker (job `listing-check`, spec 2026-10-23 §4.4).
 */
export async function listingCheckNow(listingUrl: string): Promise<ListingPageCheck> {
  const hostname = new URL(listingUrl).hostname;
  const waiting = backoffAnswer(listingUrl);
  if (waiting) return { ...unreadListingPage(waiting.verdict, listingUrl), message: waiting.message };
  try {
    // Direct by design (spec 2026-10-24 proxy §2.2, §3.4): this runs before a website exists, or for an address alone.
    const { links, html, verdict } = await withBrowserSession(async (browser) => {
      // 20 s, not the browser's default 60 s: Brooklinen never goes idle
      // and the finder sat at a blank "Find products" for 90 s waiting
      // out two 60 s networkidle timeouts (campaign 2, 2026-10-11). The
      // `load` fallback inside navigateWithFallback still applies. Then at
      // most three rounds of loading more (spec 2026-10-20 §3.7).
      const { capture, links } = await readListingPage(browser, listingUrl, { load: true, timeout: 20_000 });
      reportVerdict(hostname, capture.verdict);
      return { links, html: capture.html, verdict: capture.verdict };
    });
    return describeListingPage(links, listingUrl, html, verdict);
  } catch (err) {
    if (err instanceof CaptureError) {
      reportVerdict(hostname, err.kind);
      return unreadListingPage({ kind: err.kind }, listingUrl);
    }
    // A `CaptureProblemError`'s message is already the customer sentence
    // (verify/capture-check.ts); let it propagate as before. Anything
    // else is a throw from before any verdict existed — a Playwright
    // exception, hundreds of words, that must never reach the listing
    // bar verbatim (campaign 2, 2026-10-11).
    if (err instanceof CaptureProblemError) throw err;
    console.error('[finder] checkListingPage crashed for', listingUrl, err);
    return { ...unreadListingPage({ kind: 'crashed' }, listingUrl), message: BROWSER_UNAVAILABLE };
  }
}

/**
 * Add website's free reachability line (spec 2026-10-09 §A2): one page
 * load, one tile, no AI, nothing saved — whether the browser can read this
 * address, in the verdict's customer sentence. A `CaptureError` (no
 * document arrived) is an answer too, not a failure of the query.
 *
 * A host still backing off after a challenge or refusal (domain-lock.ts) is
 * answered from the backoff alone, without opening a browser: a query can
 * be refetched freely, and every load of a walled host extends the wall.
 *
 * Runs in the worker (job `reachability`, spec 2026-10-23 §4.4).
 */
export async function reachabilityNow(url: string): Promise<Reachability> {
  const hostname = new URL(url).hostname;
  // The wall that started the backoff, in its own words: a host that
  // refused us reads "refused", not a made-up human check (review I4).
  const waiting = backoffAnswer(url);
  if (waiting) return reachabilityResult(url, waiting.verdict, null, 0, waiting.waitMs);
  const t0 = Date.now();
  try {
    // Direct by design (spec 2026-10-24 proxy §2.2, §3.4): this runs before a website exists, or for an address alone.
    return await withBrowserSession(async (browser) => {
      const capture = await browser.capture(url, { waitUntil: 'load', interceptNetworkRequests: false, maxTiles: 1, timeout: 30_000 });
      reportVerdict(hostname, capture.verdict);
      return reachabilityResult(url, capture.verdict, capture.url, Date.now() - t0);
    });
  } catch (err) {
    if (err instanceof CaptureError) {
      reportVerdict(hostname, err.kind);
      return reachabilityResult(url, { kind: err.kind }, null, Date.now() - t0);
    }
    // Same shape as listingCheckNow above: a CaptureProblemError already
    // carries a customer sentence, so it propagates; anything else is a
    // browser-layer throw before any verdict existed.
    if (err instanceof CaptureProblemError) throw err;
    console.error('[finder] reachability crashed for', url, err);
    return { ...reachabilityResult(url, { kind: 'crashed' }, null, Date.now() - t0), message: BROWSER_UNAVAILABLE };
  }
}

/**
 * Page 1's paths run on the other proof pages (spec 2026-09-18 §3.4). Opens
 * a browser for the offline DOM search and XPath probe only — and only when
 * there is something to carry and somewhere to carry it to.
 *
 * Per target url: `null` when that page has no fresh proof-page capture,
 * otherwise the capture whose box map the `boxes` indices refer to and a
 * result per field (`null` where nothing resolved, or where page 1 has no
 * value to carry).
 *
 * Runs in the worker (job `transfer-marks`, spec 2026-10-23 §4.4).
 */
export async function transferMarksNow(input: TransferMarksPayload) {
  const source = await db.query.sources.findFirst({ where: eq(sources.id, input.sourceId), columns: { id: true, schemaDefinition: true, verificationSet: true } });
  if (!source) throw new TRPCError({ code: 'NOT_FOUND', message: `Source ${input.sourceId} not found` });
  const allFields = (source.schemaDefinition ?? []) as SchemaDefinitionField[];
  const fields = input.fieldKeys ? allFields.filter((f) => input.fieldKeys!.includes(f.key)) : allFields;
  const set = (source.verificationSet ?? { urls: [], expected: {} }) as VerificationSet;
  // The Verification tab saves drafts, but a tick transfers before its save lands, so it sends the answer on screen.
  const pageOne = (key: string) => input.from
    ? { value: input.from[key]?.value ?? '', mark: input.from[key]?.mark, via: input.from[key]?.via }
    : { value: set.expected[key]?.[input.fromUrl] ?? '', mark: set.marks?.[key]?.[input.fromUrl], via: set.paths?.[key]?.[input.fromUrl] };
  const pages = await loadProofPageCaptures(input.sourceId, [input.fromUrl, ...input.toUrls]);
  const from = pages[input.fromUrl];
  if (!from) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Mark page 1 first: it has no fresh capture' });
  // A target without a fresh capture is simply not tried — it comes back null, not an empty field map:
  // an index into a box map we do not have would be a silent wrong outline.
  const to = Object.fromEntries(input.toUrls.filter((u) => pages[u]).map((u) => [u, { capture: pages[u]!.capture, boxes: pages[u]!.meta.boxes }]));
  const out: Record<string, { captureId: string; fields: Record<string, Transferred | null> } | null> =
    Object.fromEntries(input.toUrls.map((u) => [u, pages[u] ? { captureId: pages[u]!.ref.captureId, fields: {} } : null]));
  // A field with a blank page-1 value has nothing to carry; when that is every field, no browser is opened.
  const carried = fields.filter((f) => pageOne(f.key).value.trim() !== '');
  for (const f of fields) {
    if (carried.includes(f)) continue;
    for (const u of input.toUrls) if (out[u]) out[u]!.fields[f.key] = null;
  }
  if (carried.length === 0 || Object.keys(to).length === 0) return out;
  await forWebsite(input.sourceId)(async (browser) => {
    const deps = {
      evalXPaths: (html: string, xps: string[]) => browser.setContentEvaluate<XPathProbeResult>(html, buildXPathProbeScript(xps)),
      runDomSearch: (html: string, needles: DomNeedle[], pageUrl: string) => browser.setContentEvaluate<DomHit[]>(html, buildDomSearchScript(needles, pageUrl)),
    };
    for (const field of carried) {
      const { value: expected, mark, via } = pageOne(field.key);
      const r = await transferMarks({ field, from: { url: input.fromUrl, capture: from.capture, expected, mark, via }, to }, deps);
      for (const u of input.toUrls) if (out[u]) out[u]!.fields[field.key] = r[u] ?? null;
    }
  });
  return out;
}

/**
 * Inspects this website's proof-page captures for how it exposes variants
 * — no AI, no navigation: `detectVariantLists` reads each capture's
 * structured data/intercepted JSON already on hand, and the links/pickers
 * scripts run once per capture's stored HTML inside a single
 * `withBrowserSession` (`setContentEvaluate`, same as `transferMarks`). A
 * proof page with no fresh capture reports `captured: false` and empty
 * arrays rather than being skipped — the caller still gets one row per
 * proof page, in order.
 *
 * `suggested` is computed only from what was found: `list` if any page has
 * a variant list, else `links` if any page has a link group, else `none`.
 * A source with no verification set, or one with no proof URLs yet,
 * answers `{ pages: [], suggested: 'none' }` — nothing to inspect.
 *
 * Runs in the worker (job `detect-variants`, spec 2026-10-23 §4.4).
 */
export async function detectVariantsNow(sourceId: string) {
  const source = await db.query.sources.findFirst({
    where: eq(sources.id, sourceId),
    columns: { id: true, verificationSet: true },
  });
  if (!source) throw new TRPCError({ code: 'NOT_FOUND', message: `Website ${sourceId} not found` });

  const urls = (source.verificationSet as VerificationSet | null)?.urls ?? [];
  if (urls.length === 0) return { pages: [], suggested: 'none' as const };

  const captureRecords = await loadProofPageCaptures(sourceId, urls);
  type Page = { url: string; captured: boolean; lists: VariantList[]; links: VariantLinks[]; pickers: VariantPicker[] };
  // Fix round 1: a browser is only worth opening when at least one proof
  // page has something to evaluate — every URL missing a fresh capture
  // means every row is `captured: false` with nothing to run a script
  // against, so skip `withBrowserSession` entirely rather than launching
  // Chromium to do nothing.
  const pages: Page[] = urls.some((url) => captureRecords[url])
    ? await forWebsite(sourceId)(async (browser) => {
        const out: Page[] = [];
        for (const url of urls) {
          const rec = captureRecords[url];
          if (!rec) { out.push({ url, captured: false, lists: [], links: [], pickers: [] }); continue; }
          const lists = detectVariantLists(rec.capture);
          const links = await browser.setContentEvaluate<VariantLinks[]>(rec.capture.html, buildVariantLinksScript(url));
          const pickers = await browser.setContentEvaluate<VariantPicker[]>(rec.capture.html, buildVariantPickerScript());
          out.push({ url, captured: true, lists, links, pickers });
        }
        return out;
      })
    : urls.map((url) => ({ url, captured: false, lists: [], links: [], pickers: [] }));

  const suggested = pages.some((p) => p.lists.length > 0)
    ? ('list' as const)
    : pages.some((p) => p.links.length > 0)
      ? ('links' as const)
      : ('none' as const);
  return { pages, suggested };
}

/**
 * Finds the links near an element the customer marks on a proof page's
 * screenshot (spec 2026-10-01 §3 "links" method, the manual-mark picker):
 * runs `buildLinksNearScript` against the page's fresh proof capture in
 * one `withBrowserSession`, the same `setContentEvaluate` pattern
 * `detectVariants`/`transferMarks` use. `null` when there is no fresh
 * capture of `url`, or nothing near the marked element groups into a
 * link set.
 *
 * Runs in the worker (job `variant-links-near`, spec 2026-10-23 §4.4).
 */
export async function variantLinksNearNow(input: { sourceId: string; url: string; xpath: string }) {
  const source = await db.query.sources.findFirst({ where: eq(sources.id, input.sourceId), columns: { id: true } });
  if (!source) throw new TRPCError({ code: 'NOT_FOUND', message: `Website ${input.sourceId} not found` });

  const captureRecords = await loadProofPageCaptures(input.sourceId, [input.url]);
  const rec = captureRecords[input.url];
  if (!rec) return null;

  return forWebsite(input.sourceId)((browser) => browser.setContentEvaluate<VariantLinks | null>(rec.capture.html, buildLinksNearScript(input.xpath, input.url)));
}
