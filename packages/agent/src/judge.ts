import Anthropic from '@anthropic-ai/sdk';
import { JUDGE_MODEL } from './models.js';

export type JudgeVerdict = 'correct' | 'wrong' | 'not-on-page' | 'unverifiable' | 'error';

// Deliberately a minimal edit of the long-standing prompt: the original wording
// for correct/wrong/not-on-page calibrated at 9/9 and is left untouched, with only
// the "unverifiable" option added. A fuller rewrite was tried and measurably
// degraded the "wrong" discrimination — it began accepting a wrong price and the
// `otFlat` cache-poisoning value as correct. Change this text only with
// `pnpm test:judge` in hand.
const SYSTEM = `You judge whether an extracted field value is correct on a webpage. You are shown a screenshot of the page, the field name, and the extracted value. Reply with EXACTLY one word: "correct" (the value is right), "wrong" (a value is visible on the page for this field but it's different from what was extracted), "unverifiable" (the value is an absolute URL, a schema.org URI, or an internal ID — the kind of data that lives in page metadata, which a screenshot can neither confirm nor deny), or "not-on-page" (the value the field would have is not visible on the page at all). No explanation.`;

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
      max_tokens: 16,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: opts.screenshot.toString('base64') } },
          { type: 'text', text: `Field: ${opts.field}\nExtracted value: ${JSON.stringify(opts.value)}` },
        ],
      }],
    });
    const text = res.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') return 'error';
    return parseVerdict(text.text);
  } catch (err) {
    console.error('[judge] error:', err);
    return 'error';
  }
}
