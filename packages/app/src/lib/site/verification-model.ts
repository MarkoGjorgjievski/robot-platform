// The Verification tab's pure model (spec 2026-09-25 §2.3-2.5, §3): product
// cards, the customer's answers, suggestions, the per-field battery segments,
// the Verify verdict badge, and the Verify gate. No UI, no tRPC — the route
// hands this module capture data and answers and reads back what to draw.

import { FIELD_TYPES, type FieldType } from '../fields-view';
// The engine's own comparison. `@robot/scraper/normalize` is the one module of
// that package safe for a browser bundle (it imports nothing but a type).
import { normalize, valuesEqual } from '@robot/scraper/normalize';

export { FIELD_TYPES };
export type { FieldType };

export const PRODUCTS_MIN = 3, PRODUCTS_MAX = 6;

export type Field = { key: string; name: string; type: FieldType; description: string; concept?: string };
export type Mark = { xpaths: string[]; text: string; rect: { x: number; y: number; w: number; h: number } };
export type Card = { url: string; title: string; image?: string };
/**
 * A customer's answer for one field on one product: `mark` null means typed.
 * `via`: the structured path (API, JSON-LD, meta) of the suggestion it was
 * accepted from (spec 2026-09-29 C1) — certification tries it first.
 */
export type Answer = { value: string; mark: Mark | null; via?: Via };
export type Board = { listingUrl: string; cards: Card[]; descriptions: Record<string, string>; answers: Record<string, Record<string, Answer>> };
export type Box = { xpaths: string[]; text: string; rect: Mark['rect']; tag: string; kind: 'text' | 'image' | 'link'; src?: string; href?: string };
export type Via = { source: string; path: string };
export type Suggestion = { captureId: string; value: string; boxes: number[]; origin: 'page-data' | 'from-product'; via?: Via };
/** key → url → suggestion (client-side only; never saved). */
export type Suggestions = Record<string, Record<string, Suggestion>>;
export type Segment = 'empty' | 'suggested' | 'answered' | 'failed';
export type Badge = { kind: 'verified' } | { kind: 'fails'; products: number[] } | { kind: 'changed' } | { kind: 'checking' } | null;

/** The structured sources a saved path may come from; a page-search (`xpath`) suggestion is never one. */
const STRUCTURED = ['api', 'json-ld', 'meta'] as const;
type StructuredVia = { source: (typeof STRUCTURED)[number]; path: string };
function structuredVia(via: Via | undefined): StructuredVia | undefined {
  return via && (STRUCTURED as readonly string[]).includes(via.source) ? (via as StructuredVia) : undefined;
}
const sameVia = (a: Via | undefined, b: Via | undefined) => !!a && !!b && a.source === b.source && a.path === b.path;

type VerificationResultsLike = Record<string, { certified: unknown[]; cells: Record<string, { status: 'pass' | 'fail' | 'not_captured' }> }>;

/** What `boardFrom` reads back — mirrors `@robot/scraper`'s `VerificationSet`
 * (not imported: that module graph reaches Playwright/the database/the
 * Anthropic SDK, none of which may enter a browser bundle). */
type StoredVerificationSet = {
  urls: string[];
  expected: Record<string, Record<string, string>>;
  listing_url?: string;
  marks?: Record<string, Record<string, Mark>>;
  cards?: Card[];
  paths?: Record<string, Record<string, Via>>;
};

export function emptyBoard(): Board {
  return { listingUrl: '', cards: [], descriptions: {}, answers: {} };
}

export function boardFrom(source: { schemaDefinition: unknown; verificationSet: unknown }): Board {
  const def = (source.schemaDefinition as Field[] | null) ?? [];
  const descriptions: Record<string, string> = {};
  for (const f of def) descriptions[f.key] = f.description;

  const set = source.verificationSet as StoredVerificationSet | null;
  if (!set) return { ...emptyBoard(), descriptions };

  const cardByUrl = new Map((set.cards ?? []).map((c) => [c.url, c] as const));
  const cards: Card[] = set.urls.map((url) => {
    const found = cardByUrl.get(url);
    if (found) return found;
    let title = url;
    try { title = new URL(url).pathname; } catch { /* not a parseable URL; keep it as-is */ }
    return { url, title };
  });

  const answers: Board['answers'] = {};
  for (const [key, byUrl] of Object.entries(set.expected ?? {})) {
    const kept: Record<string, Answer> = {};
    for (const [url, value] of Object.entries(byUrl)) {
      if (value.trim() === '') continue;
      const via = set.paths?.[key]?.[url];
      kept[url] = { value, mark: set.marks?.[key]?.[url] ?? null, ...(via ? { via } : {}) };
    }
    if (Object.keys(kept).length > 0) answers[key] = kept;
  }

  return { listingUrl: set.listing_url ?? '', cards, descriptions, answers };
}

export function toBindingInput(
  board: Board,
  fields: Field[],
): {
  urls: string[]; listingUrl?: string; descriptions: Record<string, string>; expected: Record<string, Record<string, string>>;
  marks?: Record<string, Record<string, Mark>>; paths?: Record<string, Record<string, StructuredVia>>; cards: Card[]; draft: true;
} {
  const urls = board.cards.map((c) => c.url.trim());
  const descriptions: Record<string, string> = {};
  const expected: Record<string, Record<string, string>> = {};
  const marks: Record<string, Record<string, Mark>> = {};
  const paths: Record<string, Record<string, StructuredVia>> = {};

  for (const f of fields) {
    descriptions[f.key] = board.descriptions[f.key] ?? f.description;
    const byUrl: Record<string, string> = {};
    const markByUrl: Record<string, Mark> = {};
    const pathByUrl: Record<string, StructuredVia> = {};
    board.cards.forEach((card, i) => {
      const a = board.answers[f.key]?.[card.url];
      byUrl[urls[i]!] = a?.value ?? '';
      if (a?.mark) markByUrl[urls[i]!] = a.mark;
      const via = structuredVia(a?.via);
      if (via) pathByUrl[urls[i]!] = { source: via.source, path: via.path };
    });
    expected[f.key] = byUrl;
    if (Object.keys(markByUrl).length > 0) marks[f.key] = markByUrl;
    if (Object.keys(pathByUrl).length > 0) paths[f.key] = pathByUrl;
  }

  return {
    urls,
    ...(board.listingUrl.trim() ? { listingUrl: board.listingUrl.trim() } : {}),
    descriptions,
    expected,
    ...(Object.keys(marks).length > 0 ? { marks } : {}),
    ...(Object.keys(paths).length > 0 ? { paths } : {}),
    cards: board.cards,
    draft: true,
  };
}

/**
 * Why the listing cannot be saved with these products, or null. The server
 * counts the listing's host in its same-website rule even for a draft
 * (binding-input.ts), so a listing elsewhere would fail every autosave.
 */
function listingProblem(board: Board, productHost: string | null): string | null {
  const l = board.listingUrl.trim();
  if (l === '') return null;
  let parsed: URL;
  try { parsed = new URL(l); } catch { return 'Paste the full listing address, starting with https://'; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'Paste the full listing address, starting with https://';
  if (productHost !== null && parsed.hostname.toLowerCase() !== productHost) return LISTING_ELSEWHERE;
  return null;
}

export const LISTING_ELSEWHERE = 'The listing must be on the same website as the products';

/** ≥ 3 cards, every url non-blank, distinct, one host — the listing's included. */
export function canSave(board: Board): boolean {
  if (board.cards.length < PRODUCTS_MIN) return false;
  const hosts = new Set<string>();
  const stripped = new Set<string>();
  for (const c of board.cards) {
    const u = c.url.trim();
    if (u === '') return false;
    let parsed: URL;
    try { parsed = new URL(u); } catch { return false; }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    hosts.add(parsed.hostname.toLowerCase());
    stripped.add(u.replace(/#.*$/, ''));
  }
  if (hosts.size > 1) return false;
  if (stripped.size !== board.cards.length) return false;
  if (listingProblem(board, [...hosts][0] ?? null)) return false;
  return true;
}

/**
 * Why these products cannot be saved or verified, in the customer's words, or
 * null. Fewer than three is not a problem here — the Verify gate says "Add at
 * least three products" for that.
 */
export function productsProblem(board: Board): string | null {
  if (board.cards.length > PRODUCTS_MAX) return 'Six products is the most a website is checked on';
  const hosts = new Set<string>();
  const pages = new Set<string>();
  for (const c of board.cards) {
    const u = c.url.trim();
    if (u === '') return 'Every product needs a page';
    let parsed: URL;
    try { parsed = new URL(u); } catch { return 'Fix the products above first'; }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'Fix the products above first';
    hosts.add(parsed.hostname.toLowerCase());
    const page = u.replace(/#.*$/, '');
    if (pages.has(page)) return 'Two products are the same page';
    pages.add(page);
  }
  if (hosts.size > 1) return 'All products must be on the same website';
  return listingProblem(board, [...hosts][0] ?? null);
}

/** Drops answers for urls no longer present. */
export function setCards(board: Board, cards: Card[]): Board {
  const urls = new Set(cards.map((c) => c.url));
  const answers: Board['answers'] = {};
  for (const [key, byUrl] of Object.entries(board.answers)) {
    const kept = Object.fromEntries(Object.entries(byUrl).filter(([url]) => urls.has(url)));
    if (Object.keys(kept).length > 0) answers[key] = kept;
  }
  return { ...board, cards, answers };
}

export function dropCard(board: Board, index: number): Board {
  return setCards(board, board.cards.filter((_, i) => i !== index));
}

/** Sets or (`a === null`) clears an answer, immutably. */
export function answer(board: Board, key: string, url: string, a: Answer | null): Board {
  const byUrl = { ...(board.answers[key] ?? {}) };
  if (a === null) delete byUrl[url]; else byUrl[url] = a;
  const answers = { ...board.answers };
  if (Object.keys(byUrl).length === 0) delete answers[key]; else answers[key] = byUrl;
  return { ...board, answers };
}

export function setDescription(board: Board, key: string, text: string): Board {
  return { ...board, descriptions: { ...board.descriptions, [key]: text } };
}

/** The box map measures in page px from the page's top left; an element outside that (a scrolled carousel, a panel measured mid-scroll) is not on the screenshot. */
function onScreenshot(box: Box): boolean {
  return box.rect.x >= 0 && box.rect.y >= 0;
}

export function valueFromBox(box: Box, type: FieldType): { value: string; mark: Mark | null } | { error: string } {
  let value: string;
  if (type === 'image') {
    if (box.kind !== 'image' || !box.src) return { error: 'This element is not an image' };
    value = box.src;
  } else if (type === 'url') {
    if (box.kind !== 'link' || !box.href) return { error: 'This element is not a link' };
    value = box.href;
  } else {
    const t = box.text.trim();
    if (t === '') return { error: 'This element has no text' };
    value = t;
  }
  // An element that starts above or left of the screenshot has a negative
  // rect, which the server refuses in a mark — and one refused mark fails
  // every autosave after it. Its value stands, as a typed one does.
  const mark: Mark | null =
    box.xpaths.length && onScreenshot(box) ? { xpaths: box.xpaths.slice(0, 3), text: type === 'image' || type === 'url' ? '' : box.text, rect: box.rect } : null;
  return { value, mark };
}

/**
 * Fields that fit the element first, then fields already answered here, then the rest; stable within groups by field order.
 *
 * `suggestion`: the popover is open on a suggestion for that field, whose
 * value is what a tick stores (final review M1) — so that field fits when
 * the suggested value is valid, whatever the element's own text says.
 */
export function fieldsFor(box: Box, fields: Field[], board: Board, url: string, suggestion?: { key: string; value: string }): Array<{ field: Field; fits: boolean; answered: boolean }> {
  const rows = fields.map((field) => {
    const r = valueFromBox(box, field.type);
    const fits =
      suggestion && suggestion.key === field.key
        ? validateValue(field.type, suggestion.value) === null
        : !('error' in r) && validateValue(field.type, r.value) === null;
    const answered = !!board.answers[field.key]?.[url];
    return { field, fits, answered };
  });
  const rank = (r: { fits: boolean; answered: boolean }) => (r.fits && !r.answered ? 0 : r.fits && r.answered ? 1 : 2);
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i)
    .map(({ r }) => r);
}

/**
 * The answer a tick on a suggestion stores (final review M1): always the
 * suggested value, and the element as its mark only when the element itself
 * shows that value by the engine's comparison. The server drops a mark whose
 * text does not equal its value (`prepareBinding`), so keeping one here would
 * show a clicked answer that reads "typed" after a reload — and a mark on the
 * wrong element must never reach certification's candidates anyway.
 */
export function answerFromSuggestion(box: Box, field: Field, value: string, url: string): Answer {
  const read = valueFromBox(box, field.type);
  if ('error' in read || !read.mark) return { value, mark: null };
  return valuesEqual(field.type, read.value, value, { pageUrl: url }) ? { value, mark: read.mark } : { value, mark: null };
}

/**
 * The answer a tick or an Accept stores for a suggestion (spec 2026-09-29 A5,
 * C1): marked by its element when it has exactly one to point at, typed
 * otherwise, and carrying its path when that path is structured.
 */
export function suggestionAnswer(boxes: Box[], field: Field, s: Suggestion, url: string): Answer {
  const one = pointable(boxes, s.boxes);
  const given = one.length === 1 ? answerFromSuggestion(boxes[one[0]!]!, field, s.value, url) : { value: s.value, mark: null };
  const via = structuredVia(s.via);
  return via ? { ...given, via } : given;
}

/**
 * The answer a click on the screenshot stores (spec A3). A click on an element
 * the field's structured suggestion outlines accepts that suggestion — its
 * value and path, the element as its mark when it shows that value; any other
 * click reads the element's own text, as before.
 */
export function pickAnswer(boxes: Box[], boxIndex: number, field: Field, url: string, s?: Suggestion): Answer | { error: string } {
  const via = structuredVia(s?.via);
  if (s && via && pointable(boxes, s.boxes).includes(boxIndex) && validateValue(field.type, s.value) === null) {
    return { ...answerFromSuggestion(boxes[boxIndex]!, field, s.value, url), via };
  }
  const box = boxes[boxIndex];
  if (!box) return { error: 'This element is not on the page' };
  return valueFromBox(box, field.type);
}

/**
 * How many places a suggestion is found in (spec A5): its elements a customer
 * can point at — except that a structured value every one of whose elements
 * shows that same value is one place (the path is the evidence).
 */
export function placesOf(boxes: Box[], s: Suggestion, field: Field, url: string): number {
  const at = pointable(boxes, s.boxes);
  if (at.length > 1 && structuredVia(s.via) && at.every((i) => {
    const read = valueFromBox(boxes[i]!, field.type);
    return !('error' in read) && valuesEqual(field.type, read.value, s.value, { pageUrl: url });
  })) return 1;
  return at.length;
}

/** Yes/no answers in one form (spec A6); the saved value is never rewritten. Other types unchanged. */
export function displayValue(field: Field, value: string): string {
  if (field.type !== 'boolean') return value;
  const n = normalize('boolean', value);
  const stock = field.concept === 'availability';
  if (n === 'true') return stock ? 'In stock' : 'Yes';
  if (n === 'false') return stock ? 'Out of stock' : 'No';
  return value;
}

/** "fails on product 1" / "fails on products 1 and 3" / "fails on products 1, 2 and 3" (spec C5). */
export function failsText(products: number[]): string {
  if (products.length === 0) return '';
  if (products.length === 1) return `fails on product ${products[0]}`;
  return `fails on products ${products.slice(0, -1).join(', ')} and ${products[products.length - 1]}`;
}

export function mergeSuggestions(
  prev: Suggestions,
  incoming: Record<string, { value: string; boxes: number[]; via?: Via } | null>,
  url: string,
  captureId: string,
  origin: Suggestion['origin'],
  board: Board,
): Suggestions {
  let next = prev;
  for (const [key, val] of Object.entries(incoming)) {
    if (!val) continue;
    if (board.answers[key]?.[url]) continue;
    // A carry fills only products with no suggestion (spec 2026-09-29 A1).
    if (origin === 'from-product' && next[key]?.[url]?.origin === 'page-data') continue;
    const byUrl = { ...(next[key] ?? {}), [url]: { captureId, value: val.value, boxes: val.boxes, origin, ...(val.via ? { via: val.via } : {}) } };
    next = { ...next, [key]: byUrl };
  }
  return next;
}

/** Drops answered cells and stale capture ids. */
/** An element narrower or shorter than this (page px) cannot be pointed at on the screenshot. */
export const MIN_BOX_SIDE = 4;

/**
 * The suggestion's elements a customer can actually click: those big enough
 * to point at, in order. A suggestion left with none is offered on the
 * field's row instead, like a page-data value no element shows — a label on
 * the screenshot over a 1×1 anchor is a rectangle nobody can open (seen on
 * Ikea, plan 5's live run). So is one that starts above or left of the
 * screenshot (Ikea, 2026-09-28: a link at y = -1066).
 */
export function pointable(boxes: Box[], indices: number[]): number[] {
  return indices.filter((i) => {
    const b = boxes[i];
    return !!b && b.rect.w >= MIN_BOX_SIDE && b.rect.h >= MIN_BOX_SIDE && onScreenshot(b);
  });
}

export function liveSuggestions(s: Suggestions, board: Board, captureIds: Record<string, string | null>): Suggestions {
  const result: Suggestions = {};
  for (const [key, byUrl] of Object.entries(s)) {
    const kept: Record<string, Suggestion> = {};
    for (const [url, sug] of Object.entries(byUrl)) {
      if (board.answers[key]?.[url]) continue;
      if (captureIds[url] !== sug.captureId) continue;
      kept[url] = sug;
    }
    if (Object.keys(kept).length > 0) result[key] = kept;
  }
  return result;
}

export type RowStatus =
  | { kind: 'accepted' }
  | { kind: 'agreed' }
  /** `odd`/`via` when the paths disagree and a majority exists (A4): "Accept anyway" takes only `via`'s cells. */
  | { kind: 'same-everywhere'; odd?: number[]; via?: Via }
  /** Spec A4: two or more share `via`; Accept takes theirs, `odd` (product numbers) stay for a person. */
  | { kind: 'majority'; odd: number[]; via: Via }
  | { kind: 'needs-you'; reason: string; product?: number };

const norm = (v: string) => v.trim().replace(/\s+/g, ' ').toLowerCase();
export function sameValue(a: string, b: string): boolean { return norm(a) === norm(b); }

/**
 * What a field's row needs (spec 2026-09-28 A2). `live` must already be
 * `liveSuggestions(...)`; `boxesByUrl[url]` is undefined until that product's
 * screenshot lands. The same source path on every product is the confidence
 * signal — it is what certification looks for — and a value that is the same
 * on every product is never agreement (a shop name offered as Brand).
 *
 * A suggestion with no pointable box is page data no element on the page
 * shows — it never agrees (spec 2026-10-09 B1; before that date it counted
 * as one place). The row needs a person to look; they accept it cell by
 * cell from the expanded row's page-data hint.
 *
 * One suggestion alone agrees with nothing (final review I1): after two
 * answers, a leftover page-data value "agrees" with itself whatever path it
 * came by. It is agreed only when it was carried from a ticked product (the
 * path is the customer's own, spec A2); otherwise the row asks for a look.
 * An answer that is not valid for the type is never accepted (M4).
 * `failedUrls`: products whose screenshot failed rather than is still coming (M6).
 */
export function rowStatus(
  field: Field,
  board: Board,
  live: Suggestions,
  boxesByUrl: Record<string, Box[] | undefined>,
  failedUrls?: ReadonlySet<string>,
): RowStatus {
  const values: string[] = [];
  const offered: Array<{ via?: Via; origin: Suggestion['origin']; product: number; value: string }> = [];
  for (const [i, card] of board.cards.entries()) {
    const url = card.url.trim();
    if (!url) continue;
    const required = i < PRODUCTS_MIN;
    const n = i + 1;
    const a = board.answers[field.key]?.[card.url];
    if (a) {
      const bad = validateValue(field.type, a.value);
      if (bad) return { kind: 'needs-you', reason: `${bad} on product ${n}`, product: n };
      values.push(a.value);
      continue;
    }
    const boxes = boxesByUrl[card.url];
    if (!boxes) {
      if (required) {
        const why = failedUrls?.has(card.url) ? 'screenshot failed' : 'screenshot not ready';
        return { kind: 'needs-you', reason: `${why} on product ${n}`, product: n };
      }
      continue;
    }
    const s = live[field.key]?.[card.url];
    if (!s) { if (required) return { kind: 'needs-you', reason: `missing on product ${n}`, product: n }; continue; }
    const places = placesOf(boxes, s, field, card.url);
    // Spec 2026-10-09 §B1: a value only the page's data carries is never agreed
    // on the row — nothing on this product's page shows it, so a person looks
    // (the expanded row's page-data hint is how they accept it, cell by cell).
    if (places === 0) return { kind: 'needs-you', reason: `only in the page data on product ${n}`, product: n };
    if (places > 1) return { kind: 'needs-you', reason: `found in ${places} places on product ${n}`, product: n };
    const err = validateValue(field.type, s.value);
    if (err) return { kind: 'needs-you', reason: `${err} on product ${n}`, product: n };
    offered.push({ via: s.via, origin: s.origin, product: n, value: s.value });
  }
  if (offered.length === 0) return { kind: 'accepted' };
  if (offered.length === 1 && offered[0]!.origin !== 'from-product') {
    const n = offered[0]!.product;
    return { kind: 'needs-you', reason: `check product ${n}`, product: n };
  }
  // Paths disagree: the majority's path, if there is one, and the products it
  // leaves for a person (A4) — kept whatever the values, so no Accept takes them.
  let split: { odd: number[]; via: Via } | undefined;
  const first = offered[0]!.via;
  if (!first || offered.some(({ via: v }) => !sameVia(v, first))) {
    const via = majorityOf(offered);
    if (!via) return { kind: 'needs-you', reason: 'comes from different places' };
    split = { odd: offered.filter((o) => !sameVia(o.via, via)).map((o) => o.product), via };
  }
  const oddSet = new Set(split?.odd ?? []);
  for (const o of offered) if (!oddSet.has(o.product)) values.push(o.value);
  // Every product in stock is normal (A6): a yes/no field is never "same on every product".
  if (field.type !== 'boolean' && values.length > 1 && values.every((v) => sameValue(v, values[0]!))) return { kind: 'same-everywhere', ...split };
  return split ? { kind: 'majority', ...split } : { kind: 'agreed' };
}

/**
 * The one path two or more suggestions share (spec A4), or undefined when no
 * path has two, or two paths tie for the most (then nobody's path is the
 * row's — the customer decides).
 */
function majorityOf(offered: Array<{ via?: Via }>): Via | undefined {
  const counts = new Map<string, { via: Via; n: number }>();
  for (const { via } of offered) {
    if (!via) continue;
    const k = `${via.source}\u0000${via.path}`;
    const c = counts.get(k);
    if (c) c.n++; else counts.set(k, { via, n: 1 });
  }
  const ranked = [...counts.values()].sort((a, b) => b.n - a.n);
  const top = ranked[0];
  if (!top || top.n < 2 || ranked[1]?.n === top.n) return undefined;
  return top.via;
}

/**
 * Accept a row's suggestions as a tick on each would (spec A3). Never
 * overwrites an answer or writes an invalid value. `only`: accept just the
 * cells whose suggestion came by that path (a majority row's Accept, A4).
 */
export function acceptRow(board: Board, field: Field, live: Suggestions, boxesByUrl: Record<string, Box[] | undefined>, only?: Via): Board {
  let next = board;
  for (const card of board.cards) {
    if (!card.url.trim() || next.answers[field.key]?.[card.url]) continue;
    const s = live[field.key]?.[card.url];
    const boxes = boxesByUrl[card.url];
    if (!s || !boxes || validateValue(field.type, s.value)) continue;
    if (only && !sameVia(s.via, only)) continue;
    next = answer(next, field.key, card.url, suggestionAnswer(boxes, field, s, card.url));
  }
  return next;
}

/**
 * May this cell's suggestion be taken in one click (spec A7, strict A4)? Only a
 * valid, unanswered suggestion found in one place once its screenshot has
 * landed — and never on an odd product: one whose suggestion came by another
 * path than one two or more other products share (their suggestions' paths and
 * their answers' paths both count, so the odd product stays for a person even
 * after the majority is accepted).
 */
export function cellAcceptable(field: Field, board: Board, live: Suggestions, boxesByUrl: Record<string, Box[] | undefined>, url: string): boolean {
  const s = live[field.key]?.[url];
  const boxes = boxesByUrl[url];
  if (!s || !boxes || board.answers[field.key]?.[url]) return false;
  if (validateValue(field.type, s.value) || placesOf(boxes, s, field, url) !== 1) return false;
  const others: Array<{ via?: Via }> = board.cards
    .filter((c) => c.url.trim() && c.url !== url)
    .map((c) => ({ via: board.answers[field.key]?.[c.url]?.via ?? live[field.key]?.[c.url]?.via }));
  const counts = new Map<string, { via: Via; n: number }>();
  for (const { via } of others) {
    if (!via) continue;
    const k = `${via.source}\u0000${via.path}`;
    const c = counts.get(k);
    if (c) c.n++; else counts.set(k, { via, n: 1 });
  }
  if ([...counts.values()].some((c) => c.n >= 2 && !sameVia(s.via, c.via))) return false;
  const n = board.cards.findIndex((c) => c.url === url) + 1;
  const st = rowStatus(field, board, live, boxesByUrl);
  return !((st.kind === 'majority' || st.kind === 'same-everywhere') && st.odd?.includes(n));
}

/** What a carry sends for page 1's answer: its value, its mark, and the structured path it was accepted from (spec A2 + C1). */
export function carryFrom(a: Answer): { value: string; mark?: Mark; via?: StructuredVia } {
  const via = structuredVia(a.via);
  return { value: a.value, ...(a.mark ? { mark: a.mark } : {}), ...(via ? { via } : {}) };
}

export function acceptAllAgreed(board: Board, fields: Field[], live: Suggestions, boxesByUrl: Record<string, Box[] | undefined>): { board: Board; accepted: string[] } {
  let next = board;
  const accepted: string[] = [];
  for (const f of fields) {
    const status = rowStatus(f, next, live, boxesByUrl);
    if (status.kind === 'agreed') next = acceptRow(next, f, live, boxesByUrl);
    else if (status.kind === 'majority') next = acceptRow(next, f, live, boxesByUrl, status.via);
    else continue;
    accepted.push(f.key);
  }
  return { board: next, accepted };
}

/** The value cell's state word — distinct from the battery's own ("confirmed"): the table calls an answered cell "accepted". */
const CELL_WORD: Record<Segment, string> = { empty: 'empty', suggested: 'suggested', answered: 'accepted', failed: 'failed' };

/**
 * A table cell's accessible name (final review M2): "Price on product 2:
 * suggested, 219.99" — the state word, then the value; a cell with no value
 * reads "…: empty" (or "failed, empty").
 */
export function cellLabel(field: string, product: number, state: Segment, value: string): string {
  const word = CELL_WORD[state];
  const v = value.trim();
  const tail = v ? `${word}, ${v}` : state === 'empty' ? word : `${word}, empty`;
  return `${field} on product ${product}: ${tail}`;
}

export function segment(board: Board, s: Suggestions, key: string, url: string, verdict: { failed: boolean }): Segment {
  if (verdict.failed) return 'failed';
  if (board.answers[key]?.[url]) return 'answered';
  if (s[key]?.[url]) return 'suggested';
  return 'empty';
}

/**
 * `unchangedKeys` (not `currentKeys`): a field whose last result failed is
 * never current, but it has not changed since — its verdict is "fails on
 * product n", and only an edit makes it "changed since verified".
 */
export function badge(args: { key: string; results: VerificationResultsLike | null; unchangedKeys: string[]; running: boolean; cards: Card[] }): Badge {
  if (args.running) return { kind: 'checking' };
  const fv = args.results?.[args.key];
  if (!fv) return null;
  if (!args.unchangedKeys.includes(args.key)) return { kind: 'changed' };
  if (fv.certified.length > 0) return { kind: 'verified' };
  const products = args.cards.flatMap((c, i) => (fv.cells[c.url]?.status === 'fail' ? [i + 1] : []));
  return products.length > 0 ? { kind: 'fails', products } : null;
}

/**
 * `field` names the field a reason is about when the fix lives on its row
 * (the descriptor), so the route can open that row. `gap` names the field a
 * product gap is about, so the route can say "Accept it first" when that
 * row is already agreed (final review M7).
 */
export function verifyGate(board: Board, fields: Field[], s: Suggestions): { ok: true } | { ok: false; reason: string; field?: string; gap?: string } {
  if (board.cards.length < PRODUCTS_MIN) return { ok: false, reason: 'Add at least three products' };
  // The server refuses a non-draft save with a blank descriptor (bindingProblems),
  // and a custom field with no catalogue entry starts with none. Reported before
  // the product gaps: it is the one the customer cannot find on the screenshot.
  for (const f of fields) {
    if (!(board.descriptions[f.key] ?? f.description ?? '').trim()) return { ok: false, reason: `Say where ${f.name} is on this website`, field: f.key };
  }
  for (let i = 0; i < board.cards.length; i++) {
    const url = board.cards[i]!.url;
    const n = i + 1;
    if (i < PRODUCTS_MIN) {
      for (const f of fields) {
        const a = board.answers[f.key]?.[url];
        if (!a) return { ok: false, reason: `${f.name} still needs product ${n}`, gap: f.key };
        const err = validateValue(f.type, a.value);
        if (err) return { ok: false, reason: `${f.name} on product ${n}: ${err}`, gap: f.key };
      }
    } else {
      const anyAnswered = fields.some((f) => board.answers[f.key]?.[url]);
      if (!anyAnswered) return { ok: false, reason: `Product ${n} needs at least one field, or drop it` };
      for (const f of fields) {
        const a = board.answers[f.key]?.[url];
        if (!a) {
          if (s[f.key]?.[url]) return { ok: false, reason: `${f.name} has a suggestion to confirm on product ${n}`, gap: f.key };
          continue;
        }
        const err = validateValue(f.type, a.value);
        if (err) return { ok: false, reason: `${f.name} on product ${n}: ${err}`, gap: f.key };
      }
    }
  }
  return { ok: true };
}

/**
 * The reason beside a disabled Verify (final review M7). When the gate's first
 * gap is on a row that is already agreed, the fix is that row's Accept, not
 * the product the gate names: "Accept Title first", or "Accept all agreed
 * first" when more than one row agrees.
 */
export function verifyReason(gate: ReturnType<typeof verifyGate>, fields: Field[], statuses: RowStatus[], buttonReason: string | undefined): string | undefined {
  if (gate.ok) return buttonReason;
  const i = gate.gap ? fields.findIndex((f) => f.key === gate.gap) : -1;
  // A majority row's Accept is an agreed row's Accept for its majority part (spec A4).
  const acceptable = (s: RowStatus | undefined) => s?.kind === 'agreed' || s?.kind === 'majority';
  if (i < 0 || !acceptable(statuses[i])) return gate.reason;
  return statuses.filter(acceptable).length > 1 ? 'Accept all agreed first' : `Accept ${fields[i]!.name} first`;
}

/** Fields not current, or everything on a first run (no results yet). */
export function reverifyScope(fields: Field[], results: VerificationResultsLike | null, currentKeys: string[]): string[] | undefined {
  if (!results || Object.keys(results).length === 0) return undefined;
  return fields.filter((f) => !currentKeys.includes(f.key) || (results[f.key]?.certified.length ?? 0) === 0).map((f) => f.key);
}

// validateValue/shortUrl below were copied (unchanged) from the deleted
// Schema tab's `validateExpectedClient`/`shortUrl` (task 4, app redesign
// plan 5) rather than moved, since the old Schema route kept importing that
// module until task 9 deleted it.
// The engine's words (`@robot/scraper`'s normalize.ts), schema.org's availability URLs included.
const TRUE = ['true', 'yes', 'y', '1', 'in stock', 'instock', 'available', 'in-stock', 'https://schema.org/instock', 'http://schema.org/instock'];
const FALSE = ['false', 'no', 'n', '0', 'out of stock', 'outofstock', 'unavailable', 'sold out', 'https://schema.org/outofstock', 'http://schema.org/outofstock'];
const TYPE_LABEL: Record<FieldType, string> = { text: 'text', number: 'a number', money: 'a money amount', boolean: 'yes/no (or in stock/out of stock)', date: 'a date', url: 'a URL', image: 'an image URL', text_list: 'a comma-separated list' };

export function validateValue(type: FieldType, text: string): string | null {
  const t = text.trim();
  if (t === '') return 'Expected value is required';
  const ok = (() => {
    switch (type) {
      case 'text': case 'text_list': return true;
      case 'number': case 'money': return /\d/.test(t) && /^[^\d]*[-+]?[\d.,]+[^\d]*$/.test(t.replace(/[A-Za-z$€£¥₹\s]/g, ''));
      case 'boolean': return TRUE.includes(t.toLowerCase()) || FALSE.includes(t.toLowerCase());
      case 'date': return /^\d{4}-\d{2}-\d{2}$/.test(t) || !Number.isNaN(Date.parse(t));
      case 'url': case 'image': try { return /^https?:$/.test(new URL(t).protocol); } catch { return false; }
    }
  })();
  return ok ? null : `Not ${TYPE_LABEL[type]}`;
}

export function shortUrl(url: string): string {
  let p: string;
  try { const u = new URL(url); p = u.pathname + (u.search ? '?…' : ''); } catch { p = url; }
  if (p.length <= 28) return p;
  return `${p.slice(0, 13)}…${p.slice(-14)}`;
}
