// packages/scraper/src/verify/shown-text.ts
// Text as a page shows it, one rule for every place a heading or a shown value is compared (final review I1/I2,
// first run 2026-10-26): the heading the Verification tab reads (`pageHeading`), its heading rule (the app's
// `sameHeading`), the run-time "shown on the page" check (`pageTextOf`/`shownOnPage`, the app's `shown.ts`) and
// Jev's heading candidate. Pure and import-free, so the app's browser bundle can import it
// (`@robot/scraper/shown-text`) as it does `/normalize`.
//
// Every tag is a space, so separately styled spans never glue (React's `<span>Nike</span><span>Air Max 90</span>`
// reads "Nike Air Max 90"); entities are decoded; and a space before a symbol mark is dropped, because a mark
// in its own element (Skullcandy's `Crusher<span class="marks">®</span> 720`) would otherwise read "Crusher ® 720",
// which neither the page's own text nor any value is.

/** Symbol marks that attach to the word before them. */
const BEFORE_MARK = /\s+(?=[®™©℠℗])/gu;
const AFTER_MARK = /([®™©℠℗])\s+/gu;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', reg: '®', trade: '™', copy: '©' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,6});/gi, (m, e: string) => {
    const cp = e[0] === '#' ? (e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : NaN;
    if (!Number.isNaN(cp)) return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Text tidied as shown: no space before a symbol mark ("Crusher ® 720" → "Crusher® 720"), whitespace collapsed, trimmed. */
export function tidyShownText(s: string): string {
  return s.replace(BEFORE_MARK, '').replace(/\s+/g, ' ').trim();
}

/** Markup's visible text: scripts and styles dropped, every tag a space, entities decoded, then `tidyShownText`. */
export function shownTextFromHtml(html: string): string {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ');
  return tidyShownText(decodeEntities(text));
}

/**
 * The comparison form of shown text: `tidyShownText`, a space after a mark dropped too (so "Crusher®720" and
 * "Crusher® 720" compare alike), then NFKC — after the marks are settled, since NFKC spells ™ as "TM" — and
 * lower case. Compare two strings, or look for one inside a page's text, only in this form.
 */
export function shownKey(s: string): string {
  return tidyShownText(s).replace(AFTER_MARK, '$1').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Do two texts read as the same shown text (the heading rule's comparison)? */
export function sameShownText(a: string, b: string): boolean {
  return shownKey(a) === shownKey(b);
}
