// packages/scraper/src/verify/variant-collector.ts
// Certifies a website's variant links across its proof pages (spec 2026-10-01
// §3, "links" method): one XPath that yields exactly the confirmed variant
// hrefs on every proof page that has variants, and nothing (or a disjoint
// set) on a page the customer confirmed has none. Also finds the links near
// an element the customer marks on a screenshot, for the picker/manual-mark
// flow. In-page scripts, dependency-free and self-contained like
// dom-scripts.ts and variant-dom.ts: helpers below are stringified via
// toString() into the scripts, pageUrl is passed through JSON.stringify, and
// every href is resolved with `new URL(href, pageUrl)`. Mirrors
// variant-certify.ts's page handling and failure messages exactly.
import { PAGE_SCRIPT_PRELUDE } from './dom-scripts.js';
import { NO_PRODUCT_HAS_VARIANTS, type VariantPageResult, type VariantVerification } from './variant-certify.js';
import type { CaptureLike } from './certify.js';
import type { VariantAnswer } from './types.js';
// VariantLinks (variant-dom.ts) describes buildLinksNearScript's in-page result shape
// ({ container, count, links }) — named only in the JSDoc below, never imported: the function
// itself returns a string (the in-page script text), not a VariantLinks value.

export type EvalScript = <T>(html: string, script: string) => Promise<T>;

const MAX_COLLECTOR_CANDIDATES = 12;
/** A class token too generic — a utility/layout class, not something a vendor would name a variant control — to anchor a candidate on (plan 2026-10-01 Task 2). */
const UTILITY_TOKEN_PATTERN = '^(is-|has-|js-|d-|flex|grid|col|row|mt-|mb-|p-|px-|py-)';

// ---- Everything below runs INSIDE the page: stringified via toString() into the scripts at the
// bottom of this file, the same pattern variant-dom.ts uses. Dependency-free: no imports, no
// closures over module state.

/** Trimmed text, else title, else aria-label, else an inner img's alt. Same rules as variant-dom.ts's linkLabel. */
function linkLabel(a: Element): string {
  const text = (a.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (text) return text;
  const title = (a.getAttribute('title') ?? '').trim();
  if (title) return title;
  const aria = (a.getAttribute('aria-label') ?? '').trim();
  if (aria) return aria;
  const img = a.querySelector('img[alt]');
  if (img) {
    const alt = (img.getAttribute('alt') ?? '').trim();
    if (alt) return alt;
  }
  return '';
}

/** A short CSS-ish description of el, for the report. Same as variant-dom.ts's describeContainer. */
function describeContainer(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.getAttribute('id');
  if (id) return `${tag}#${id}`;
  const cls = (el.getAttribute('class') ?? '').trim().split(/\s+/).filter(Boolean);
  if (cls.length) return `${tag}.${cls.join('.')}`;
  for (const attr of Array.from(el.attributes)) {
    if (attr.name.indexOf('data-') === 0) return `${tag}[${attr.name}="${attr.value}"]`;
  }
  return tag;
}

/**
 * Resolves href against pageUrl; null for a fragment, javascript:, non-http(s), or unparseable
 * href — same guards as variant-dom.ts's resolveHref (not exported there, so mirrored here). The
 * fragment is also stripped from the resolved href, so `/p/x#a` and `/p/x` are the same link: a
 * mark on a hash-anchor swatch must not read as two distinct variants of the same page.
 */
function resolveAgainst(href: string, pageUrl: string): string | null {
  const h = href.trim();
  if (h === '' || h.charAt(0) === '#' || /^javascript:/i.test(h)) return null;
  try {
    const u = new URL(h, pageUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    return u.href;
  } catch {
    return null;
  }
}

/** The lowest common ancestor of a non-empty list of elements, by repeatedly widening until it contains every one. */
function lowestCommonAncestor(elements: Element[]): Element | null {
  if (elements.length === 0) return null;
  let ancestor: Element | null = elements[0]!;
  for (let i = 1; i < elements.length && ancestor; i++) {
    const el = elements[i]!;
    while (ancestor && !ancestor.contains(el)) ancestor = ancestor.parentElement;
  }
  return ancestor;
}

/** Candidate XPaths anchored on one element: id, then each non-utility class token, then aria-label — a value containing `'` is skipped (unsafe to quote). */
function candidatesForElement(el: Element, utilityRe: RegExp): string[] {
  const out: string[] = [];
  const id = el.getAttribute('id');
  if (id && !id.includes("'")) out.push(`//*[@id='${id}']//a/@href`);
  const cls = (el.getAttribute('class') ?? '').trim();
  if (cls) {
    for (const token of cls.split(/\s+/).filter(Boolean)) {
      if (utilityRe.test(token) || token.includes("'")) continue;
      out.push(`//*[contains(concat(' ', normalize-space(@class), ' '), ' ${token} ')]//a/@href`);
    }
  }
  const aria = el.getAttribute('aria-label');
  if (aria && !aria.includes("'")) out.push(`//*[@aria-label='${aria}']//a/@href`);
  return out;
}

/** Evaluates (in a page) to string[]: up to 12 candidate XPaths (each ending in //a/@href), de-duplicated, anchored on the lowest common ancestor of the links matching `hrefs` and up to 3 of its own ancestors. */
export function buildCollectorCandidatesScript(hrefs: string[], pageUrl: string): string {
  return `(() => {
    ${PAGE_SCRIPT_PRELUDE}
    const pageUrl = ${JSON.stringify(pageUrl)};
    const hrefSet = new Set(${JSON.stringify(hrefs)});
    const utilityRe = new RegExp(${JSON.stringify(UTILITY_TOKEN_PATTERN)});
    const resolveAgainst = ${resolveAgainst.toString()};
    const lowestCommonAncestor = ${lowestCommonAncestor.toString()};
    const candidatesForElement = ${candidatesForElement.toString()};
    const maxCandidates = ${MAX_COLLECTOR_CANDIDATES};
    const links = [];
    for (const a of document.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href');
      if (!href) continue;
      const resolved = resolveAgainst(href, pageUrl);
      if (resolved && hrefSet.has(resolved)) links.push(a);
    }
    if (links.length === 0) return [];
    const ancestor = lowestCommonAncestor(links);
    if (!ancestor) return [];
    const out = [];
    const seen = new Set();
    const add = (xp) => { if (!seen.has(xp)) { seen.add(xp); out.push(xp); } };
    let cur = ancestor;
    for (let depth = 0; depth < 4 && cur && out.length < maxCandidates; depth++) {
      for (const xp of candidatesForElement(cur, utilityRe)) {
        add(xp);
        if (out.length >= maxCandidates) break;
      }
      cur = cur.parentElement;
    }
    return out.slice(0, maxCandidates);
  })()`;
}

/** Evaluates (in a page) to string[][], one entry per xpath: the attribute values of `document.evaluate(xpath, ..., ORDERED_NODE_SNAPSHOT_TYPE, ...)`, resolved against pageUrl, de-duplicated, in document order. */
export function buildXPathHrefsScript(xpaths: string[], pageUrl: string): string {
  return `(() => {
    ${PAGE_SCRIPT_PRELUDE}
    const pageUrl = ${JSON.stringify(pageUrl)};
    const xpaths = ${JSON.stringify(xpaths)};
    const resolveAgainst = ${resolveAgainst.toString()};
    const out = [];
    for (const xp of xpaths) {
      const hrefs = [];
      const seen = new Set();
      try {
        const snap = document.evaluate(xp, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        for (let i = 0; i < snap.snapshotLength; i++) {
          const attr = snap.snapshotItem(i);
          const raw = attr && attr.value != null ? String(attr.value) : '';
          if (!raw) continue;
          const resolved = resolveAgainst(raw, pageUrl);
          if (!resolved || seen.has(resolved)) continue;
          seen.add(resolved);
          hrefs.push(resolved);
        }
      } catch {}
      out.push(hrefs);
    }
    return out;
  })()`;
}

/** Evaluates (in a page) to VariantLinks | null: from the element at `xpath`, walks up to 3 ancestors until one holds >= 2 distinct same-host a[href], labelled like buildVariantLinksScript. */
export function buildLinksNearScript(xpath: string, pageUrl: string): string {
  return `(() => {
    ${PAGE_SCRIPT_PRELUDE}
    const pageUrl = ${JSON.stringify(pageUrl)};
    const resolveAgainst = ${resolveAgainst.toString()};
    const linkLabel = ${linkLabel.toString()};
    const describeContainer = ${describeContainer.toString()};
    let host = '';
    try { host = new URL(pageUrl).host; } catch {}
    const r = document.evaluate(${JSON.stringify(xpath)}, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    const node = r.singleNodeValue;
    const el = node && node.nodeType === 1 ? node : (node ? node.parentElement : null);
    if (!el) return null;
    let cur = el.parentElement;
    for (let depth = 0; depth < 3 && cur; depth++) {
      const seen = new Map();
      for (const a of cur.querySelectorAll('a[href]')) {
        const href = a.getAttribute('href');
        if (!href) continue;
        const resolved = resolveAgainst(href, pageUrl);
        if (!resolved) continue;
        let u;
        try { u = new URL(resolved); } catch { continue; }
        if (u.host !== host) continue;
        if (seen.has(resolved)) continue;
        seen.set(resolved, linkLabel(a));
      }
      if (seen.size >= 2) {
        const links = Array.from(seen, ([href, label]) => ({ href, label }));
        return { container: describeContainer(cur), count: links.length, links };
      }
      cur = cur.parentElement;
    }
    return null;
  })()`;
}

/**
 * The one normal form for a variant link, everywhere it is stored or
 * compared: absolute, fragment stripped (the same form `resolveAgainst` gives
 * in the page and detection's `resolveHref` stores). Answers stored before
 * detection stripped fragments still compare equal through this. An href
 * that does not parse is kept as given, trimmed.
 */
export function normalizeVariantLink(href: string): string {
  const h = href.trim();
  try {
    const u = new URL(h);
    u.hash = '';
    return u.href;
  } catch {
    return h;
  }
}

/** Every link in its normal form (`normalizeVariantLink`), de-duplicated, first-seen order. */
export function normalizeVariantLinks(hrefs: string[]): string[] {
  return [...new Set(hrefs.map(normalizeVariantLink))];
}

type PageInfo = { url: string; n: number; answer: VariantAnswer; capture: CaptureLike | null };

function hrefSetsEqual(a: string[], b: Set<string>): boolean {
  if (a.length !== b.size) return false;
  return a.every((h) => b.has(h));
}

/**
 * Certify a website's variant collector across its proof pages (links
 * method). Mirrors certifyVariantList's page handling and failure messages
 * exactly (variant-certify.ts): product n = index + 1 in `urls`, an
 * unanswered url counts as `count: 0`, a null capture is `not_captured`. The
 * spot-check of a variant page is not part of this function (Task 4 adds it).
 */
export async function certifyVariantLinks(
  input: { urls: string[]; captures: Record<string, CaptureLike | null>; answers: Record<string, VariantAnswer>; noun: string },
  deps: { evalScript: EvalScript },
): Promise<Omit<VariantVerification, 'hash' | 'method'>> {
  const { urls, captures, answers, noun } = input;
  const { evalScript } = deps;

  const pages: PageInfo[] = urls.map((url, i) => ({
    url, n: i + 1, answer: answers[url] ?? { count: 0, labels: [] }, capture: captures[url] ?? null,
  }));

  const withVariants = pages.filter((p) => p.answer.count > 0);
  if (withVariants.length === 0) {
    const out: Record<string, VariantPageResult> = {};
    for (const p of pages) out[p.url] = p.capture ? { status: 'none' } : { status: 'not_captured' };
    return { passed: false, problem: NO_PRODUCT_HAS_VARIANTS, pages: out };
  }

  // Every page's confirmed links in the one normal form (normalizeVariantLink), once: an answer
  // stored with `#fragment` hrefs (before detection stripped them) still matches the in-page
  // resolution, which strips the fragment too.
  const linksOf = new Map<string, string[]>(pages.map((p) => [p.url, normalizeVariantLinks(p.answer.links ?? [])]));

  // Step 3: gather candidates across every page that has variants, first-seen order, de-duplicated.
  const candidates: string[] = [];
  const seenCandidates = new Set<string>();
  for (const p of withVariants) {
    if (!p.capture || !p.answer.links) continue;
    const found = await evalScript<string[]>(p.capture.html, buildCollectorCandidatesScript(linksOf.get(p.url)!, p.url));
    for (const xp of found) {
      if (!seenCandidates.has(xp)) { seenCandidates.add(xp); candidates.push(xp); }
    }
  }

  const captured = pages.filter((p) => p.capture !== null);

  // Step 4: evaluate every candidate on every captured page, one call per page.
  const hrefsByUrl = new Map<string, string[][]>();
  for (const p of captured) {
    const result = candidates.length > 0
      ? await evalScript<string[][]>(p.capture!.html, buildXPathHrefsScript(candidates, p.url))
      : [];
    hrefsByUrl.set(p.url, result);
  }

  const fitsPage = (idx: number, p: PageInfo): boolean => {
    const hrefs = hrefsByUrl.get(p.url)?.[idx] ?? [];
    if (p.answer.count === 0) return hrefs.length === 0;
    return hrefSetsEqual(hrefs, new Set(linksOf.get(p.url)!));
  };

  let chosenIdx = -1;
  if (candidates.length > 0) {
    chosenIdx = candidates.findIndex((_, idx) => captured.every((p) => fitsPage(idx, p)));
    if (chosenIdx === -1) {
      let bestIdx = -1;
      let bestScore = -1;
      candidates.forEach((_, idx) => {
        const score = captured.filter((p) => fitsPage(idx, p)).length;
        if (score > bestScore) { bestScore = score; bestIdx = idx; }
      });
      chosenIdx = bestIdx;
    }
  }

  const failures: Record<string, string> = {};
  if (chosenIdx >= 0) {
    for (const p of captured) {
      if (fitsPage(chosenIdx, p)) continue;
      const found = hrefsByUrl.get(p.url)?.[chosenIdx] ?? [];
      const k = found.length;
      // "found {k} of {count}" counts the confirmed links actually found, not every link read:
      // the same number of links with different members is k of count, never "found 4, expected 4".
      const confirmed = new Set(linksOf.get(p.url)!);
      const matched = found.filter((h) => confirmed.has(h)).length;
      if (p.answer.count === 0) failures[p.url] = `product ${p.n} lists ${k} ${noun} — confirm them`;
      else if (k === 0) failures[p.url] = `found no ${noun} on product ${p.n}`;
      else if (k > p.answer.count) failures[p.url] = `found ${k} ${noun} on product ${p.n}, expected ${p.answer.count}`;
      else failures[p.url] = `found ${matched} of ${p.answer.count} ${noun} on product ${p.n}`;
    }
  } else {
    // No candidate at all: nothing can be read, same as every candidate reading empty.
    for (const p of captured) {
      if (p.answer.count > 0) failures[p.url] = `found no ${noun} on product ${p.n}`;
    }
  }

  const out: Record<string, VariantPageResult> = {};
  for (const p of pages) {
    if (!p.capture) { out[p.url] = { status: 'not_captured' }; continue; }
    const msg = failures[p.url];
    if (msg) { out[p.url] = { status: 'fail', message: msg }; continue; }
    out[p.url] = p.answer.count > 0 ? { status: 'pass', count: p.answer.count } : { status: 'none' };
  }
  const passed = Object.values(out).every((r) => r.status !== 'fail' && r.status !== 'not_captured');

  return { passed, ...(chosenIdx >= 0 ? { collector: candidates[chosenIdx]! } : {}), pages: out };
}

