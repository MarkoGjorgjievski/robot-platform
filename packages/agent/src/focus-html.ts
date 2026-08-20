// Choosing WHICH slice of a page the selector model sees.
//
// The model gets a character budget far smaller than a modern listing page.
// Taking the first N characters showed it the header, nav and footer of a 790k
// -character category page and never one product tile — so it answered "link to
// the product page" with the site's privacy policy. Nothing was wrong with the
// prompt; it was shown the wrong 6% of the document.
//
// A human doesn't read from the top either. They look at the page, spot where
// the results start — under a "Featured Items" heading, below the filter nav —
// and jump there. This module reproduces that with a ladder of locators, each
// returning a candidate offset and a confidence. The best-scoring one wins, and
// the losing ones are why the ladder is here at all: a page with no headings
// still has repeating cards, a page with hashed class names still has repeated
// <article> tags, and a page with none of those still clusters its images.

export type FocusSignal = {
  index: number;
  confidence: number;
  strategy: string;
  detail: string;
};

export type FocusResult = {
  text: string;
  strategy: string;
  index: number;
};

/** Strips what no selector can target, so the budget is spent on real markup. */
export function cleanHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '')
    .replace(/<link\b[^>]*\/?>/gi, '')
    .replace(/<meta\b[^>]*\/?>/gi, '')
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Start offset of the `width`-wide window covering the most of `positions`.
 *
 * This is what separates a real results grid from decoration: a recommendation
 * carousel scatters a dozen links across the page, the grid puts a hundred in
 * one place.
 */
export function densestWindow(positions: number[], width: number): number {
  if (positions.length === 0) return 0;
  const sorted = [...positions].sort((a, b) => a - b);
  let best = sorted[0]!;
  let bestCount = 0;
  let left = 0;
  for (let right = 0; right < sorted.length; right++) {
    while (sorted[right]! - sorted[left]! > width) left++;
    const count = right - left + 1;
    if (count > bestCount) {
      bestCount = count;
      best = sorted[left]!;
    }
  }
  return best;
}

function positionsOf(html: string, pattern: RegExp): number[] {
  return [...html.matchAll(pattern)].map((m) => m.index ?? 0);
}

type Cluster = { start: number; count: number; span: number; medianGap: number; score: number };

/**
 * How much a set of repeated positions looks like a results grid rather than chrome.
 *
 * Counting repetitions is exactly backwards, which one real page proves: its nav
 * and filter widgets repeat 287 times, its twelve product tiles twelve times. The
 * signal that separates them is the GAP — a filter checkbox recurs every ~170
 * characters, a product tile every ~3,300, because a tile is a big piece of
 * markup. So gap dominates the score and count is capped early, deliberately
 * refusing to reward a menu for being long.
 */
function clusterScore(positions: number[], width: number): Cluster | null {
  if (positions.length < 5) return null;
  const start = densestWindow(positions, width);
  const inWindow = positions.filter((p) => p >= start && p < start + width).sort((a, b) => a - b);
  if (inWindow.length < 5) return null;

  const gaps = inWindow.slice(1).map((p, i) => p - inWindow[i]!).sort((a, b) => a - b);
  const medianGap = gaps[Math.floor(gaps.length / 2)] ?? 0;
  const span = inWindow[inWindow.length - 1]! - inWindow[0]!;

  const gapScore = Math.max(0, Math.min(1, (medianGap - 300) / 2_700));
  const countScore = Math.min(1, inWindow.length / 12);
  const coverage = Math.min(1, span / width);

  return {
    start,
    count: inWindow.length,
    span,
    medianGap,
    score: 0.55 * gapScore + 0.25 * countScore + 0.2 * coverage,
  };
}

/** Class-name words that usually mark a result tile. A hint, never the sole signal —
 *  frameworks emit hashed names like `_card_a1b2c`, so repetition matters more. */
const TILE_WORDS = /(grid|card|item|product|result|tile|cell|listing|entry|post|hit)/i;

// ─── The ladder ──────────────────────────────────────────────────────────────

/**
 * Markup that names itself as the results.
 *
 * `<ul id="srp-search-results-list" aria-label="Search Results">` sits exactly on
 * a real book list, with `<li id="product-0">` immediately inside. An author
 * saying "this is the results list" beats any statistic computed over the
 * document — and it costs nothing to read.
 */
const RESULTS_ATTRIBUTE = new RegExp(
  '(?:id|aria-label|data-test-id|data-testid|data-cy|role)="[^"]*'
  + '(?:search-?results?|results?-(?:list|grid|container|items)|listing-?(?:list|grid|results)|product-?(?:list|grid))'
  + '[^"]*"',
  'gi',
);

function byResultsAttribute(html: string): FocusSignal | null {
  const matches = [...html.matchAll(RESULTS_ATTRIBUTE)];
  if (matches.length === 0) return null;
  // The LAST such attribute: pages tend to mention their results container in a
  // skip-link or aria description before rendering it, and the container itself
  // is what we want to read from.
  const chosen = matches[matches.length - 1]!;
  return {
    index: chosen.index ?? 0,
    confidence: 0.92,
    strategy: 'results-attribute',
    detail: chosen[0].slice(0, 60),
  };
}

/** Collapses whitespace and punctuation so screenshot text can match markup text. */
function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Text the screenshot reported sitting just above the results.
 *
 * Matching has to tolerate what a vision model actually returns. Live, one
 * returned "Python (Over 100,000 results)" — visually exact, but not a literal
 * substring of the markup, because the count is rendered in its own element. An
 * exact-match-only lookup threw the entire vision signal away.
 */
function byLandmark(html: string, landmark?: string): FocusSignal | null {
  if (!landmark) return null;
  const trimmed = landmark.trim();
  if (trimmed.length < 3) return null;

  let first = html.indexOf(trimmed);
  if (first === -1) {
    // Match the landmark's WORDS against the original document, allowing markup
    // and punctuation between them — "Featured Items" survives being split across
    // a <span>, and the offset stays in the document's own coordinates. Searching
    // a normalised copy instead would return an offset from a different string.
    const words = normalise(trimmed).split(' ').filter((w) => w.length > 2);
    for (let size = Math.min(4, words.length); size >= 2 && first === -1; size--) {
      for (let start = 0; start + size <= words.length && first === -1; start++) {
        const phrase = words.slice(start, start + size)
          .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('[^a-z0-9]{1,80}');
        const matches = [...html.matchAll(new RegExp(phrase, 'gi'))];
        if (matches.length > 0) first = matches[matches.length - 1]!.index ?? -1;
      }
    }
    if (first === -1) return null;
    // Below a self-describing results container, above the statistical rungs:
    // a partial text match is real evidence, but weaker than markup that names
    // itself and weaker than an exact landmark hit.
    return { index: first, confidence: 0.91, strategy: 'landmark', detail: `"${trimmed}" (partial match)` };
  }

  const last = html.lastIndexOf(trimmed);
  // A landmark occurring once is a strong anchor; several occurrences means it is
  // also chrome (a repeated "Add to cart"), so trust it less.
  const unique = first === last;
  return {
    index: last,
    confidence: unique ? 0.95 : 0.6,
    strategy: 'landmark',
    detail: `"${trimmed}"${unique ? '' : ' (not unique)'}`,
  };
}

/** A class token that repeats like a row container does. */
function byRepeatedClass(html: string, width: number): FocusSignal | null {
  const counts = new Map<string, number[]>();
  for (const match of html.matchAll(/class="([^"]{1,200})"/g)) {
    const at = match.index ?? 0;
    for (const token of match[1]!.split(/\s+/)) {
      if (token.length < 3 || token.length > 40) continue;
      const seen = counts.get(token) ?? [];
      seen.push(at);
      counts.set(token, seen);
    }
  }
  let best: FocusSignal | null = null;
  let bestRaw = 0;
  for (const [token, at] of counts) {
    const cluster = clusterScore(at, width);
    if (!cluster) continue;
    // A tile-ish name only breaks ties between similar clusters — frameworks emit
    // hashed names, so the shape of the repetition has to carry the decision.
    const raw = cluster.score + (TILE_WORDS.test(token) ? 0.05 : 0);
    // Compare RAW and clamp only on the way out. Clamping first made every strong
    // candidate tie at the ceiling, and the tie went to whichever token appeared
    // earliest in the document — which is the navigation, every time.
    if (!best || raw > bestRaw) {
      bestRaw = raw;
      best = {
        index: cluster.start,
        confidence: Math.min(0.9, raw),
        strategy: 'repeated-class',
        detail: `.${token} ×${cluster.count}, gap ${cluster.medianGap}`,
      };
    }
  }
  return best;
}

/** Repeated semantic containers — the shape a well-built listing still has. */
function bySemanticRepeat(html: string, width: number): FocusSignal | null {
  let best: FocusSignal | null = null;
  for (const tag of ['article', 'li', 'tr', 'section']) {
    const cluster = clusterScore(positionsOf(html, new RegExp(`<${tag}\\b`, 'gi')), width);
    if (!cluster) continue;
    // <article> means what it says; <li> is also every nav menu on the page, so
    // it leans harder on the gap evidence to earn the same score.
    const weight = tag === 'article' ? 0.9 : tag === 'tr' ? 0.85 : 0.7;
    const score = cluster.score * weight;
    if (!best || score > best.confidence) {
      best = {
        index: cluster.start,
        confidence: score,
        strategy: 'semantic-repeat',
        detail: `<${tag}> ×${cluster.count}, gap ${cluster.medianGap}`,
      };
    }
  }
  return best;
}

/**
 * Links whose URL SHAPE repeats — what a person means by "those all look the same".
 *
 * A results list points at one kind of page, so its hrefs share a path template
 * once ids and slugs are normalised away. Scored through `clusterScore` like
 * everything else, because the most NUMEROUS shape is usually navigation: on one
 * real page a 32-link nav group outnumbered the twelve product tiles, and only
 * the gap between occurrences told them apart.
 */
function byLinkShape(html: string, width: number): FocusSignal | null {
  const groups = new Map<string, number[]>();
  for (const match of html.matchAll(/<a\b[^>]*href="([^"]+)"/gi)) {
    let shape: string;
    try {
      shape = new URL(match[1]!, 'https://relative.invalid')
        .pathname.replace(/\d+/g, '#').replace(/[a-z0-9]{12,}/gi, '*');
    } catch {
      continue;
    }
    // A bare "/" is every logo and home link on the page, never a results list.
    if (shape === '/' || shape.length < 2) continue;
    const seen = groups.get(shape) ?? [];
    seen.push(match.index ?? 0);
    groups.set(shape, seen);
  }

  let best: FocusSignal | null = null;
  let bestRaw = 0;
  for (const [shape, at] of groups) {
    const cluster = clusterScore(at, width);
    if (!cluster) continue;
    if (!best || cluster.score > bestRaw) {
      bestRaw = cluster.score;
      best = {
        index: cluster.start,
        confidence: Math.min(0.88, cluster.score),
        strategy: 'link-shape',
        detail: `${shape} ×${cluster.count}, gap ${cluster.medianGap}`,
      };
    }
  }
  return best;
}

/** Where the links that look like item pages actually pile up. */
function byLinkDensity(html: string, width: number): FocusSignal | null {
  const at = positionsOf(html, /<a\b[^>]*href="[^"]+"/gi);
  if (at.length < 10) return null;
  const start = densestWindow(at, width);
  const inWindow = at.filter((p) => p >= start && p < start + width).length;
  if (inWindow < 10) return null;
  return {
    index: start,
    confidence: Math.min(0.75, 0.3 + inWindow / 120),
    strategy: 'link-density',
    detail: `${inWindow} links`,
  };
}

/** Every result tile carries a thumbnail; a wall of images is a wall of results. */
function byImageCluster(html: string, width: number): FocusSignal | null {
  const at = positionsOf(html, /<img\b[^>]*src="[^"]+"/gi);
  if (at.length < 8) return null;
  const start = densestWindow(at, width);
  const inWindow = at.filter((p) => p >= start && p < start + width).length;
  if (inWindow < 8) return null;
  return {
    index: start,
    confidence: Math.min(0.6, 0.25 + inWindow / 100),
    strategy: 'image-cluster',
    detail: `${inWindow} images`,
  };
}

/**
 * Filter/sort/category chrome sits immediately above the results on almost every
 * search and category page, so its END is a good place to start reading.
 */
function byFilterNav(html: string): FocusSignal | null {
  const markers = [/id="[^"]*filter[^"]*"/i, /class="[^"]*(facet|filter|refine|sort-by|sortby)[^"]*"/i, /aria-label="[^"]*(filter|sort)[^"]*"/i];
  let latest = -1;
  let which = '';
  for (const marker of markers) {
    const found = html.search(marker);
    if (found > latest) {
      latest = found;
      which = marker.source.slice(0, 32);
    }
  }
  if (latest === -1) return null;
  return { index: latest, confidence: 0.45, strategy: 'filter-nav', detail: which };
}

/**
 * The slice of `html` most likely to contain the page's repeating content.
 *
 * `landmark` is text a vision pass read off the screenshot as sitting just above
 * the results — the most human way to find them, and the most precise when the
 * heading exists in the DOM.
 */
export function focusWindow(
  html: string,
  maxChars: number,
  options: { landmark?: string } = {},
): FocusResult {
  if (html.length <= maxChars) {
    return { text: html, strategy: 'whole-document', index: 0 };
  }

  const signals = [
    byLandmark(html, options.landmark),
    byResultsAttribute(html),
    byRepeatedClass(html, maxChars),
    byLinkShape(html, maxChars),
    bySemanticRepeat(html, maxChars),
    byLinkDensity(html, maxChars),
    byImageCluster(html, maxChars),
    byFilterNav(html),
  ].filter((s): s is FocusSignal => s !== null);

  if (signals.length === 0) {
    return { text: sliceOnTagBoundary(html, 0, maxChars), strategy: 'head-of-document', index: 0 };
  }

  const winner = signals.reduce((a, b) => (b.confidence > a.confidence ? b : a));
  // Start a little above the anchor: the container's opening tag and the heading
  // that introduces it are what tell the model this is the repeating region.
  const lead = Math.min(2_000, Math.floor(maxChars * 0.05));
  const start = Math.max(0, winner.index - lead);
  return {
    text: sliceOnTagBoundary(html, start, maxChars),
    strategy: winner.strategy,
    index: start,
  };
}

/** Cuts on a tag boundary so the model is never handed a half-written element. */
function sliceOnTagBoundary(html: string, start: number, maxChars: number): string {
  const from = start === 0 ? 0 : (html.indexOf('<', start) === -1 ? start : html.indexOf('<', start));
  const slice = html.slice(from, from + maxChars);
  if (slice.length < maxChars) return slice;
  const cut = slice.lastIndexOf('>');
  return cut > 0 ? slice.slice(0, cut + 1) : slice;
}
