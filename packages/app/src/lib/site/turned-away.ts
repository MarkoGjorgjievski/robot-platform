// When a website turns us away (spec 2026-10-28 §3.6): what a product card says while its proof page
// waits for the next try, tries again, or was given up, and the one bar above the table. Pure — the
// route renders these words; `useNow` (lib/use-now.ts) is the clock.
//
// Customer copy names the website by its own name and never says how we get in (CLAUDE.md, Customer
// copy): a try by the fallback route reads "Trying another way in". Staff read the stored sentence and
// the route.
import type { ProofCapture } from './proof-capture-state';

export type CardTone = 'muted' | 'warn';
export type CardIcon = 'spinner' | 'clock' | 'alert' | null;
export type CardAction = 'swap' | 'retry';
export type CardWords = { tone: CardTone; icon: CardIcon; lines: string[]; actions: CardAction[] };

/** Tries in all when the answer does not say (the ladder's `LADDER_TRIES`). */
const TRIES = 4;
const TAIL = "Swap this product for another, or try again later. We've told our team.";
const NO_SCREENSHOT = 'The screenshot could not be taken';
/** Staff only: the route a try took or takes. Never shown to a customer. */
const VIA_FALLBACK = ' (via fallback proxy)';

const WALLS = new Set(['refused', 'challenge']);

/** The website's name at the start of a sentence and inside one; "This website" when it has none. */
export function websiteName(name: string | null | undefined): { start: string; mid: string } {
  const n = name?.trim() ?? '';
  return n ? { start: n, mid: n } : { start: 'This website', mid: 'this website' };
}

/** A countdown as m:ss, seconds rounded up (so 0:00 only at the moment itself); never negative. */
export function mmss(ms: number): string {
  const s = Number.isFinite(ms) && ms > 0 ? Math.ceil(ms / 1000) : 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Whole minutes from the first try to `last`, rounded up, at least 1; null without a readable start or end. */
export function minutesSpent(first: string | undefined, last: string | number): number | null {
  const from = first ? Date.parse(first) : Number.NaN;
  const to = typeof last === 'number' ? last : Date.parse(last);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.max(1, Math.ceil((to - from) / 60_000));
}

const minutesText = (m: number) => (m === 1 ? '1 minute' : `${m} minutes`);

/** The given-up sentence, by the tries actually made (a 30-minute cap can give up before four). */
export function giveUpSentence(attempts: number | undefined, minutes: number | null, name: string | null | undefined): string {
  const { start, mid } = websiteName(name);
  const n = attempts ?? 0;
  if (minutes === null) {
    // No clock (a row without its last try's start): the minutes are left out, never guessed.
    if (n >= 2) return `We tried ${n} times and ${mid} kept turning us away. ${TAIL}`;
    if (n === 1) return `We tried once and ${mid} turned us away. ${TAIL}`;
    return `${start} kept turning us away. ${TAIL}`;
  }
  if (n >= 2) return `We tried ${n} times over ${minutesText(minutes)} and ${mid} kept turning us away. ${TAIL}`;
  if (n === 1) return `We tried once and ${mid} kept turning us away for ${minutesText(minutes)}. ${TAIL}`;
  return `${start} kept turning us away for ${minutesText(minutes)}. ${TAIL}`;
}

/** Waiting for its next try, or that try in progress (a retry, try 2 or later). */
export function isWaiting(c: ProofCapture | undefined): boolean {
  return !!c && (c.status === 'waiting' || (c.status === 'capturing' && (c.attempt ?? 1) >= 2));
}

/** The ladder ran out: every try was turned away. */
export function isGivenUp(c: ProofCapture | undefined): boolean {
  return !!c && c.status === 'failed' && c.gaveUp === true;
}

/**
 * What a field row says about this product's screenshot (`rowStatus`'s `failedKinds`): `waiting` while
 * it waits or tries again, `turned-away` for a wall (given up, or a refusal or human check that was
 * never retried), else a failure's verdict kind; undefined when there is nothing to say.
 */
export function captureKind(c: ProofCapture | undefined): string | undefined {
  if (!c) return undefined;
  if (isWaiting(c)) return 'waiting';
  if (c.status !== 'failed') return undefined;
  if (c.gaveUp || (c.verdict && WALLS.has(c.verdict.kind))) return 'turned-away';
  return c.verdict?.kind;
}

/** Whether the shared 1 s clock needs to tick: some card counts up or down. */
export function nowActive(captures: ReadonlyArray<ProofCapture | undefined>): boolean {
  return captures.some((c) => !!c && (c.status === 'starting' || c.status === 'capturing' || c.status === 'waiting'));
}

const elapsed = (startedAt: string | undefined, nowMs: number): string => {
  const t = startedAt ? Date.parse(startedAt) : Number.NaN;
  return Number.isFinite(t) ? ` ${Math.max(0, Math.floor((nowMs - t) / 1000))} s` : '';
};

/** One product card's state (spec §3.6): its icon, tone, lines (each wraps; none is clamped) and actions. */
export function cardWords(c: ProofCapture | undefined, name: string | null | undefined, nowMs: number, opts: { staff?: boolean } = {}): CardWords {
  const route = opts.staff && c?.via === 'fallback' ? VIA_FALLBACK : '';
  if (!c || c.status === 'starting') return { tone: 'muted', icon: 'spinner', lines: ['Taking screenshot…'], actions: [] };

  if (c.status === 'capturing') {
    const secs = elapsed(c.startedAt, nowMs);
    if (!isWaiting(c)) return { tone: 'muted', icon: 'spinner', lines: [`Taking screenshot…${secs}${route}`], actions: [] };
    const doing = c.via === 'fallback' ? 'Trying another way in…' : 'Trying again…';
    return { tone: 'warn', icon: 'spinner', lines: [`${doing}${secs}${route}`, `Try ${c.attempt} of ${c.of ?? TRIES}`], actions: ['swap'] };
  }

  if (c.status === 'waiting') {
    const first = opts.staff && c.error ? `${c.error}${route}` : `${websiteName(name).start} turned us away.`;
    const at = c.retryAt ? Date.parse(c.retryAt) : Number.NaN;
    const left = Number.isFinite(at) ? at - nowMs : 0;
    const next = left <= 0 ? 'Trying now…' : `${c.via === 'fallback' ? 'Trying another way in' : 'Trying again in'} ${mmss(left)}`;
    return { tone: 'warn', icon: 'clock', lines: [first, next, `Try ${c.attempt ?? 1} of ${c.of ?? TRIES}`], actions: ['swap'] };
  }

  if (c.status === 'failed') {
    if (c.gaveUp) {
      // From the first try to the last try's start, both stored: a number that never grows after the fact.
      const minutes = c.startedAt ? minutesSpent(c.firstStartedAt, c.startedAt) : null;
      const lines = [giveUpSentence(c.attempts, minutes, name)];
      if (opts.staff && c.error) lines.push(`${c.error}${route}`);
      return { tone: 'warn', icon: 'alert', lines, actions: ['retry', 'swap'] };
    }
    return { tone: 'warn', icon: 'alert', lines: [c.error || NO_SCREENSHOT], actions: ['retry'] };
  }

  return { tone: 'muted', icon: null, lines: ['ready'], actions: [] };
}

/** "product 1", "products 1 and 2", "products 1, 2 and 3". */
function products(ns: number[]): string {
  if (ns.length === 1) return `product ${ns[0]}`;
  return `products ${ns.slice(0, -1).join(', ')} and ${ns[ns.length - 1]}`;
}

/**
 * The one bar above the table (spec §3.6), or null: while any of the first three cards waits for a
 * try or was given up on a wall. `cards` is in card order; a blank card is undefined.
 */
export function barWords(cards: ReadonlyArray<ProofCapture | undefined>, name: string | null | undefined, nowMs: number): string | null {
  const first = cards.slice(0, 3);
  const waiting: number[] = [];
  const gaveUp: number[] = [];
  const others: number[] = [];
  let soonest = Number.POSITIVE_INFINITY;
  first.forEach((c, i) => {
    if (isWaiting(c)) {
      waiting.push(i + 1);
      const at = c!.status === 'waiting' && c!.retryAt ? Date.parse(c!.retryAt) : Number.NaN;
      if (Number.isFinite(at) && at > nowMs) soonest = Math.min(soonest, at);
    } else if (isGivenUp(c)) gaveUp.push(i + 1);
    // Only a product that is ready, or on its first try, is one to keep working on — never another failure.
    else if (c && (c.status === 'captured' || c.status === 'capturing' || c.status === 'starting')) others.push(i + 1);
  });
  if (waiting.length === 0 && gaveUp.length === 0) return null;
  const { start } = websiteName(name);
  const parts: string[] = [];
  if (waiting.length > 0) {
    parts.push(`${start} turned us away on ${products(waiting)}.`);
    parts.push(Number.isFinite(soonest) ? `We're trying again on our own, next in ${mmss(soonest - nowMs)}.` : "We're trying again on our own now.");
  }
  if (gaveUp.length > 0) {
    parts.push(`${start} kept turning us away on ${products(gaveUp)}.`);
    parts.push(gaveUp.length === 1 ? 'Swap it for another product, or try again later.' : 'Swap them for other products, or try again later.');
  }
  if (waiting.length > 0 && others.length > 0) parts.push(`You can keep working on ${products(others)}.`);
  return parts.join(' ');
}
