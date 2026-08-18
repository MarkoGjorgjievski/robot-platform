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
}): Promise<JudgeVerdict> {
  const client = new Anthropic({ apiKey: opts.apiKey });
  try {
    const res = await client.messages.create({
      model: opts.model ?? JUDGE_MODEL,
      ...JUDGE_REQUEST_TUNING,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: opts.screenshot.toString('base64') } },
          { type: 'text', text: `Field: ${opts.field}\nExtracted value: ${JSON.stringify(opts.value)}` },
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
