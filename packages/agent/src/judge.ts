import Anthropic from '@anthropic-ai/sdk';
import { JUDGE_MODEL } from './models.js';
import { recordUsage } from './usage.js';

export type JudgeVerdict = 'correct' | 'wrong' | 'not-on-page' | 'unverifiable' | 'error';

// Deliberately a minimal edit of the long-standing prompt: the original wording
// for correct/wrong/not-on-page calibrated at 9/9 and is left untouched, with only
// the "unverifiable" option added. A fuller rewrite was tried and measurably
// degraded the "wrong" discrimination — it began accepting a wrong price and the
// `otFlat` cache-poisoning value as correct. Change this text only with
// `pnpm test:judge` in hand.
const SYSTEM = `You judge whether an extracted field value is correct on a webpage. You are shown a screenshot of the page, the field name, and the extracted value. Reply with EXACTLY one word: "correct" (the value is right), "wrong" (a value is visible on the page for this field but it's different from what was extracted), "unverifiable" (the value is an absolute URL, a schema.org URI, or an internal ID — the kind of data that lives in page metadata, which a screenshot can neither confirm nor deny), or "not-on-page" (the value the field would have is not visible on the page at all). No explanation.`;

// Appended to SYSTEM only when the caller passes the page's visible text, so a
// call without it (the calibration suite, `pnpm test:judge`) sends the
// calibrated prompt unchanged. Campaign 2 (2026-10-12): descriptions folded
// behind "read more", ratings drawn as stars and "MYR 910" vs "910" were read
// as wrong from the screenshot alone. Says "correct"/"wrong", the reply words,
// so the model does not answer with a word parseVerdict cannot read. The second
// sentence keeps a number the text shows for something else (a shipping
// threshold, a size, another variant's price) from reading as correct.
const PAGE_TEXT_SENTENCE = ` A value that the page text shows as THIS product's value for the field is correct even when the screenshot hides it (folded text, a star widget, a currency prefix). A value that appears in the text only for something else — another product, a shipping threshold, a size, another variant — is wrong.`;

// Appended to SYSTEM only when the value was cut short by the caller (a long
// description judged on its first 80 characters), for the same reason.
const TRUNCATED_SENTENCE = ` A value cut short and ending in "…" is correct when the part shown matches the start of the page's value for the field.`;

/** The page text sent beside the screenshot is capped at this many characters (the first ones). */
export const PAGE_TEXT_LIMIT = 8_000;
/** Which part of the page's text the caller sends: a window around the value, or the page's first characters. */
export type PageTextKind = 'excerpt' | 'start';
export function pageTextHeading(kind: PageTextKind): string {
  const part = kind === 'excerpt' ? 'an excerpt around the value' : 'the start of the page';
  return `The page's visible text, ${part} (may include content folded behind 'read more' or shown as star icons):`;
}
export const TRUNCATED_NOTE = 'The extracted value is long and is shown cut to its first 80 characters, ending in "…".';

/**
 * Shared request tuning for both judges.
 *
 * `thinking: disabled` is load-bearing, not an optimisation. The judges are
 * one-word classifiers on a tiny token budget, and thinking is ON BY DEFAULT for
 * the current model family. On a complex real screenshot the model spends the
 * whole budget reasoning and returns a `thinking` block with NO text block —
 * which this code reports as verdict 'error'. That silently produced 3 bogus
 * 'error' verdicts on the 2026-08-18 Newegg run (stop_reason=max_tokens,
 * blocks=thinking). It does not reproduce on simple fixture pages, so the
 * calibration suite alone will not catch a regression here.
 *
 * max_tokens has headroom over the longest verdict ("unverifiable") so a stray
 * leading token cannot truncate the answer.
 */
const JUDGE_REQUEST_TUNING = {
  max_tokens: 32,
  thinking: { type: 'disabled' as const },
};

export { JUDGE_REQUEST_TUNING };

/** Map the model's one-word reply onto a verdict. Order matters: check the
 *  'not'/'unverifiable' prefixes before the looser ones. */
function parseVerdict(raw: string): JudgeVerdict {
  const t = raw.trim().toLowerCase();
  if (t.startsWith('correct')) return 'correct';
  if (t.startsWith('wrong')) return 'wrong';
  if (t.startsWith('unverifiable')) return 'unverifiable';
  if (t.startsWith('not')) return 'not-on-page';
  return 'error';
}

export { parseVerdict };

/**
 * The judge cannot run at all — exhausted credit, bad key, revoked access.
 *
 * Distinct from a verdict of 'error', which means "this one field could not be
 * judged". A run that hits this will fail identically on every remaining field,
 * so callers should abort rather than issue hundreds of doomed requests and
 * publish a report full of 'error' that reads like a measurement.
 *
 * Thrown rather than returned precisely so it cannot be quietly folded into the
 * verdict counts, which is how a credit exhaustion on 2026-08-18 produced a
 * report whose later sites were entirely unjudged with only an aggregate line to
 * say so.
 */
export class JudgeUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JudgeUnavailableError';
  }
}

/** True for API failures that will recur on every subsequent call. */
export function isJudgeUnavailable(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  if (status === 401 || status === 403) return true;
  const message = err instanceof Error ? err.message : String(err);
  return /credit balance|billing|quota|insufficient_quota|authentication/i.test(message);
}

export async function judgeFieldExtraction(opts: {
  screenshot: Buffer;
  field: string;
  value: unknown;
  apiKey: string;
  model?: string;
  /** The page's visible text; sent before the screenshot (at most PAGE_TEXT_LIMIT characters) when given. */
  pageText?: string;
  /** What `pageText` is: an excerpt around the value, or the start of the page (default). */
  pageTextKind?: PageTextKind;
  /** True when `value` was cut to its first 80 characters plus "…" by the caller. */
  valueTruncated?: boolean;
}): Promise<JudgeVerdict> {
  const client = new Anthropic({ apiKey: opts.apiKey });
  const withText = opts.pageText != null && opts.pageText.trim() !== '';
  const system = SYSTEM + (withText ? PAGE_TEXT_SENTENCE : '') + (opts.valueTruncated ? TRUNCATED_SENTENCE : '');
  const ask = `Field: ${opts.field}\nExtracted value: ${JSON.stringify(opts.value)}${opts.valueTruncated ? `\n${TRUNCATED_NOTE}` : ''}`;
  try {
    const res = await client.messages.create({
      model: opts.model ?? JUDGE_MODEL,
      ...JUDGE_REQUEST_TUNING,
      system,
      messages: [{
        role: 'user',
        content: [
          ...(withText ? [{ type: 'text' as const, text: `${pageTextHeading(opts.pageTextKind ?? 'start')}\n${opts.pageText!.slice(0, PAGE_TEXT_LIMIT)}` }] : []),
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: opts.screenshot.toString('base64') } },
          { type: 'text', text: ask },
        ],
      }],
    });
    recordUsage(opts.model ?? JUDGE_MODEL, res.usage);
    const text = res.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') {
      console.error(
        `[judge] no text block for ${opts.field} (stop_reason=${res.stop_reason}, blocks=${res.content.map((b) => b.type).join(',') || 'none'})`,
      );
      return 'error';
    }
    return parseVerdict(text.text);
  } catch (err) {
    console.error('[judge] error:', err);
    return 'error';
  }
}
