// Which clickable advances this listing?
//
// A pure heuristic over raw HTML, mirroring `detectPaginationFromHtml`: no DOM,
// no browser, so it unit-tests for free. The AI fallback is wired at the call
// site, exactly as it is for HTML pagination detection.
//
// Returning a SELECTOR rather than an element is deliberate — the caller clicks
// it inside the page.

import { pageScript } from './overlays.js';

/**
 * Wordings that mean "there is more below" — English plus German, French, Spanish, Italian,
 * Dutch, Portuguese and Swedish (controller ruling, spec 2026-10-20). Whole names, matched
 * case-insensitively by `textOf`; anything else is not a pager.
 */
export const LOAD_MORE_TEXT: readonly string[] = [
  'load more', 'show more', 'see more', 'view more', 'more results',
  'mehr anzeigen', 'weitere laden', 'mehr laden',
  'voir plus', 'afficher plus', 'charger plus',
  'ver más', 'cargar más', 'mostrar más',
  'mostra altro', 'carica altro',
  'meer laden', 'toon meer',
  'ver mais', 'carregar mais',
  'visa fler', 'ladda fler',
];

const CLICKABLE = /<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
const ID_ATTR = /\bid\s*=\s*["']([^"']+)["']/i;
const CLASS_ATTR = /\bclass\s*=\s*["']([^"']+)["']/i;

/** Visible text with tags and entities stripped, collapsed and lowercased. */
function textOf(inner: string): string {
  return inner.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * A CSS selector for the clickable that advances the listing, or null.
 *
 * `afterText`, when given, enforces the position rule: a control appearing
 * BEFORE the results is a filter or a sidebar toggle, not a pager. "Show more"
 * in a faceted-search sidebar is the common false positive, and clicking it
 * changes the result set rather than extending it.
 *
 * It is a raw string rather than a container selector on purpose: the caller
 * has page 1's own detail URLs and nothing upstream knows what wraps the grid,
 * so a URL page 1 actually produced is the one anchor available as evidence
 * rather than as a guess. A guard the caller cannot supply an argument for is a
 * guard that never fires.
 */
export function findLoadMore(html: string, afterText?: string): string | null {
  const resultsAt = afterText ? html.indexOf(afterText) : -1;

  for (const match of html.matchAll(CLICKABLE)) {
    const [whole, tag, attrs, inner] = match;
    if (!LOAD_MORE_TEXT.includes(textOf(inner ?? ''))) continue;
    if (resultsAt >= 0 && (match.index ?? 0) < resultsAt) continue;

    const id = ID_ATTR.exec(attrs ?? '')?.[1];
    if (id) return `#${id}`;
    const cls = CLASS_ATTR.exec(attrs ?? '')?.[1]?.split(/\s+/).filter(Boolean);
    // Prefer the most specific-looking class — a bare "btn" matches half the page.
    const best = cls?.slice().sort((a, b) => b.length - a.length)[0];
    if (best) return `${tag}.${best}`;
    void whole;
  }
  return null;
}

// ---- Loading more of a listing before it is read (spec 2026-10-20 §3.7) ----------------------

/** Spec 2026-10-20 §5.3: the loading never runs more rounds than this, whatever a caller asks. */
export const LOAD_MORE_MAX_ROUNDS = 3;
/** Rounds in a row that add nothing before the loading stops. */
export const LOAD_MORE_QUIET_ROUNDS = 2;
/** How long a round waits after its scroll, and after a click, for the page to add what it loads. */
export const LOAD_MORE_SETTLE_MS = 1_000;
/**
 * Spec 2026-10-20 §5.3 (controller ruling): the whole loading step stops within about this long,
 * wall time. Checked before each round, each settle and each click — only the step under way
 * finishes — so nothing more starts once the budget is spent, whatever `rounds` and
 * `LOAD_MORE_MAX_ROUNDS` still allow.
 */
export const LOAD_MORE_BUDGET_MS = 10_000;

/**
 * Up to the top, then down the page in steps of most of a window — a lazy grid loads what
 * enters the viewport, and jumping straight to the bottom skips it (and Chromium's scroll
 * anchoring keeps a bottom-pinned viewport from ever firing another scroll) — then the bottom.
 * At most 30 steps. Resolves when done.
 */
export const STEP_SCROLL_SCRIPT = `(async () => {
  window.scrollTo(0, 0);
  await new Promise((r) => setTimeout(r, 100));
  const step = Math.max(400, Math.floor(window.innerHeight * 0.9));
  for (let y = step, i = 0; y < document.documentElement.scrollHeight && i < 30; y += step, i++) {
    window.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 120));
  }
  window.scrollTo(0, document.documentElement.scrollHeight);
})()`;

/** Marks the document. A `history.pushState` keeps the mark; a navigation loses it. */
export const MARK_DOCUMENT_SCRIPT = `(() => { window.__robotLoadMore = 1; return true; })()`;
/** Is this still the marked document? */
export const SAME_DOCUMENT_SCRIPT = `(() => window.__robotLoadMore === 1)()`;

/**
 * For a load-more selector: is its first match visible, a variant control the capture must never
 * click (controller ruling: reuses §3.3.2's `isVariantChoice`, the same guard the tabs step uses),
 * and the link it sits in (for `hrefNavigates`). Null when nothing matches.
 *
 * Built with `pageScript` (not a bare template string) so the in-page check shares the one
 * `isVariantChoice` the overlays module already has, rather than a second copy of §3.3.2's rules.
 */
export function loadMoreTargetScript(selector: string): string {
  return pageScript(`(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const a = el.closest('a');
  return {
    visible: r.width > 0 && r.height > 0,
    href: a ? a.getAttribute('href') : null,
    target: a ? a.getAttribute('target') : null,
    variant: isVariantChoice(el),
  };
})()`);
}
