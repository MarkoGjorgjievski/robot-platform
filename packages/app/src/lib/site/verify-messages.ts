// Verify never fails silently (spec 2026-10-20): every sentence a customer reads when Verify, a
// re-verify or a proof-page capture does not succeed, and the Verify stage line. Pure. No sentence
// names a field key, an address, an HTTP status, "@", a library's error text or an internal word
// (§2, §5.4); field names and product numbers are the customer's own.

/** Mirrors `@robot/api`'s `VerifyProblem` (verify/verify-refusal.ts); never imported. */
export type VerifyProblemLike =
  | { reason: 'blank'; field: string; product: number }
  | { reason: 'too_few_values'; field: string }
  | { reason: 'no_fields' }
  | { reason: 'variants' }
  | { reason: 'other' };

export const VERIFY_COULD_NOT_START = 'Verify could not start. Try again; if it keeps happening, contact us.';
export const NO_FIELDS = 'This website has no fields yet. Add fields to the project, then verify.';
export const CONFIRM_VARIANTS = 'Confirm the variants of every product first';
export const FAILED_RUN_KEPT = 'Verify stopped before it finished. Your last results are kept — try again.';
/** Planner's copy: a run that failed with no completed run before it has nothing to keep. */
export const FAILED_RUN_NOTHING_KEPT = 'Verify stopped before it finished. Try again.';
export const SCREENSHOT_TOO_LONG = 'The screenshot took too long. Take it again.';
export const SCREENSHOT_COULD_NOT_START = 'The screenshot could not start. Take it again.';
/** Planner's copy: the badge of a field whose AI step failed and that has no failing product to name. */
export const AI_UNAVAILABLE_BADGE = 'not finished — verify again';
/** Planner's copy: the badge of a failed field with no failing product and every page captured. */
export const NOT_VERIFIED_BADGE = 'not verified — mark it on the screenshot';
/** Planner's copy: a capture reason that is missing or not fit to show. */
export const PAGE_NOT_READ = 'the page could not be read';

export function problemSentence(p: VerifyProblemLike): string {
  switch (p.reason) {
    case 'blank':
      return `${p.field} on product ${p.product} needs a value, or "Not on this product". Nothing was checked.`;
    case 'too_few_values':
      return `${p.field} needs a value on at least two products, or "not on this product" on every one.`;
    case 'no_fields':
      return NO_FIELDS;
    case 'variants':
      return CONFIRM_VARIANTS;
    case 'other':
      return VERIFY_COULD_NOT_START;
  }
}

const named = (s: unknown): s is string => typeof s === 'string' && s.trim() !== '';

function isProblem(x: unknown): x is VerifyProblemLike {
  if (!x || typeof x !== 'object') return false;
  const p = x as { reason?: unknown; field?: unknown; product?: unknown };
  switch (p.reason) {
    case 'blank':
      return named(p.field) && typeof p.product === 'number' && Number.isInteger(p.product) && p.product >= 1;
    case 'too_few_values':
      return named(p.field);
    case 'no_fields':
    case 'variants':
    case 'other':
      return true;
    default:
      return false;
  }
}

/**
 * One sentence for a refused Verify: the first problem that names something, else "could not start".
 * One sentence only, so a problem the server repeats for the same field and product (a blank cell
 * that is also marked arrives as a `blank` and an `other`) never reads twice, and `other` never
 * hides a problem the customer can fix.
 */
export function refusalSentence(problems: readonly unknown[] | null | undefined): string {
  const valid = (problems ?? []).filter(isProblem);
  const first = valid.find((p) => p.reason !== 'other') ?? valid[0];
  return first ? problemSentence(first) : VERIFY_COULD_NOT_START;
}

/** What a failed `sources.verify` call says (spec §3.2): the server's structured problems, never the error's message. */
export function refusalFromError(err: unknown): string {
  const problems = err && typeof err === 'object' ? (err as { data?: { verifyProblems?: unknown } }).data?.verifyProblems : undefined;
  return refusalSentence(Array.isArray(problems) ? problems : null);
}

export function failedRunSentence(hasResults: boolean): string {
  return hasResults ? FAILED_RUN_KEPT : FAILED_RUN_NOTHING_KEPT;
}

/** The Verify bar's one message (spec §3.1): nothing while a Verify runs; else the refusal (newest), else the failed run. */
export function verifyMessage(args: { refusal: string | null; failedRun: { id: string } | null; hasResults: boolean; running: boolean }): string | null {
  if (args.running) return null;
  if (args.refusal) return args.refusal;
  return args.failedRun ? failedRunSentence(args.hasResults) : null;
}

export function aiUnavailableHint(field: string): string {
  return `We couldn't finish checking ${field} this time. Verify again — nothing else changed.`;
}

/** Library text, a stack, an internal word, or something too long to be a sentence of ours. */
const RAW = /\b(?:Error|Exception)\b|Timeout \d+ms|\bpage\.\w+|net::ERR_|browserType|Target (?:page|closed)|\n|\s at /;

/** A redirect's stored reason ("redirected to https://…", which drift reads as is) in customer words: never an address (spec §5.4). */
export const PAGE_REDIRECTED = 'the address opened a different page';
const URL_IN_TEXT = /https?:\/\//i;
const REDIRECTED = /^redirected to /i;

function readableReason(reason: string | undefined): string {
  const r = (reason ?? '').trim().replace(/\.+$/, '');
  if (REDIRECTED.test(r)) return PAGE_REDIRECTED;
  if (!r || r === 'not captured' || r === 'stalled' || r.length > 240 || RAW.test(r) || URL_IN_TEXT.test(r)) return PAGE_NOT_READ;
  return r;
}

/** A field a failed capture left unchecked on a product (spec §3.5.2): the stored verdict sentence, never raw text. */
export function notCheckedText(product: number, reason: string | undefined): string {
  return `Not checked on product ${product} — ${readableReason(reason)}.`;
}

/** A proof-page capture's stored error as a card shows it (spec §3.5.5): "stalled" in words; a verdict sentence as it is. */
export function captureErrorText(error: string | undefined): string | undefined {
  if (error === undefined) return undefined;
  if (error === 'stalled') return SCREENSHOT_TOO_LONG;
  // A stored verdict sentence shows as it is; a redirect, or anything holding an address, is reworded (spec §5.4).
  if (REDIRECTED.test(error.trim())) return 'The address opened a different page. Check the link, or use another product.';
  return URL_IN_TEXT.test(error) ? `The screenshot could not be taken — ${PAGE_NOT_READ}.` : error;
}

/** Verify's stage line (`runVerification`'s onProgress stages) in customer words; the raw stage names a key and "AI". */
export function stageText(stage: string | null, fieldNames: Record<string, string>): string | null {
  if (stage === null) return null;
  if (stage === 'starting') return 'Starting…';
  const capturing = /^capturing (\d+)\/(\d+)$/.exec(stage);
  if (capturing) return `Taking screenshot ${capturing[1]} of ${capturing[2]}…`;
  if (stage === 'searching') return 'Looking for your values on the pages…';
  const asking = /^asking AI for (.+)$/.exec(stage);
  if (asking) return `Taking a closer look at ${fieldNames[asking[1]!] ?? 'a field'}…`;
  if (stage === 'checking variants') return 'Checking the variants…';
  return 'Verifying…';
}
