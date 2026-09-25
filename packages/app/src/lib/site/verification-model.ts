// The Verification tab's pure model (spec 2026-09-25 §2.3-2.5, §3): product
// cards, the customer's answers, suggestions, the per-field battery segments,
// the Verify verdict badge, and the Verify gate. No UI, no tRPC — the route
// hands this module capture data and answers and reads back what to draw.

import { FIELD_TYPES, type FieldType } from '../fields-view';
// The engine's own comparison. `@robot/scraper/normalize` is the one module of
// that package safe for a browser bundle (it imports nothing but a type).
import { valuesEqual } from '@robot/scraper/normalize';

export { FIELD_TYPES };
export type { FieldType };

export const PRODUCTS_MIN = 3, PRODUCTS_MAX = 6;

export type Field = { key: string; name: string; type: FieldType; description: string };
export type Mark = { xpaths: string[]; text: string; rect: { x: number; y: number; w: number; h: number } };
export type Card = { url: string; title: string; image?: string };
/** A customer's answer for one field on one product: `mark` null means typed. */
export type Answer = { value: string; mark: Mark | null };
export type Board = { listingUrl: string; cards: Card[]; descriptions: Record<string, string>; answers: Record<string, Record<string, Answer>> };
export type Box = { xpaths: string[]; text: string; rect: Mark['rect']; tag: string; kind: 'text' | 'image' | 'link'; src?: string; href?: string };
export type Suggestion = { captureId: string; value: string; boxes: number[]; origin: 'page-data' | 'from-product' };
/** key → url → suggestion (client-side only; never saved). */
export type Suggestions = Record<string, Record<string, Suggestion>>;
export type Segment = 'empty' | 'suggested' | 'answered' | 'failed';
export type Badge = { kind: 'verified' } | { kind: 'fails'; product: number } | { kind: 'changed' } | { kind: 'checking' } | null;

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
      kept[url] = { value, mark: set.marks?.[key]?.[url] ?? null };
    }
    if (Object.keys(kept).length > 0) answers[key] = kept;
  }

  return { listingUrl: set.listing_url ?? '', cards, descriptions, answers };
}

export function toBindingInput(
  board: Board,
  fields: Field[],
): { urls: string[]; listingUrl?: string; descriptions: Record<string, string>; expected: Record<string, Record<string, string>>; marks?: Record<string, Record<string, Mark>>; cards: Card[]; draft: true } {
  const urls = board.cards.map((c) => c.url.trim());
  const descriptions: Record<string, string> = {};
  const expected: Record<string, Record<string, string>> = {};
  const marks: Record<string, Record<string, Mark>> = {};

  for (const f of fields) {
    descriptions[f.key] = board.descriptions[f.key] ?? f.description;
    const byUrl: Record<string, string> = {};
    const markByUrl: Record<string, Mark> = {};
    board.cards.forEach((card, i) => {
      const a = board.answers[f.key]?.[card.url];
      byUrl[urls[i]!] = a?.value ?? '';
      if (a?.mark) markByUrl[urls[i]!] = a.mark;
    });
    expected[f.key] = byUrl;
    if (Object.keys(markByUrl).length > 0) marks[f.key] = markByUrl;
  }

  return {
    urls,
    ...(board.listingUrl.trim() ? { listingUrl: board.listingUrl.trim() } : {}),
    descriptions,
    expected,
    ...(Object.keys(marks).length > 0 ? { marks } : {}),
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
  const mark: Mark | null = box.xpaths.length ? { xpaths: box.xpaths.slice(0, 3), text: type === 'image' || type === 'url' ? '' : box.text, rect: box.rect } : null;
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

export function mergeSuggestions(
  prev: Suggestions,
  incoming: Record<string, { value: string; boxes: number[] } | null>,
  url: string,
  captureId: string,
  origin: Suggestion['origin'],
  board: Board,
): Suggestions {
  let next = prev;
  for (const [key, val] of Object.entries(incoming)) {
    if (!val) continue;
    if (board.answers[key]?.[url]) continue;
    const byUrl = { ...(next[key] ?? {}), [url]: { captureId, value: val.value, boxes: val.boxes, origin } };
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
 * Ikea, plan 5's live run).
 */
export function pointable(boxes: Box[], indices: number[]): number[] {
  return indices.filter((i) => {
    const b = boxes[i];
    return !!b && b.rect.w >= MIN_BOX_SIDE && b.rect.h >= MIN_BOX_SIDE;
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
  for (let i = 0; i < args.cards.length; i++) {
    const cell = fv.cells[args.cards[i]!.url];
    if (cell?.status === 'fail') return { kind: 'fails', product: i + 1 };
  }
  return null;
}

/**
 * `field` names the field a reason is about when the fix lives on its row
 * (the descriptor), so the route can open that row.
 */
export function verifyGate(board: Board, fields: Field[], s: Suggestions): { ok: true } | { ok: false; reason: string; field?: string } {
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
        if (!a) return { ok: false, reason: `${f.name} still needs product ${n}` };
        const err = validateValue(f.type, a.value);
        if (err) return { ok: false, reason: `${f.name} on product ${n}: ${err}` };
      }
    } else {
      const anyAnswered = fields.some((f) => board.answers[f.key]?.[url]);
      if (!anyAnswered) return { ok: false, reason: `Product ${n} needs at least one field, or drop it` };
      for (const f of fields) {
        const a = board.answers[f.key]?.[url];
        if (!a) {
          if (s[f.key]?.[url]) return { ok: false, reason: `${f.name} has a suggestion to confirm on product ${n}` };
          continue;
        }
        const err = validateValue(f.type, a.value);
        if (err) return { ok: false, reason: `${f.name} on product ${n}: ${err}` };
      }
    }
  }
  return { ok: true };
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
