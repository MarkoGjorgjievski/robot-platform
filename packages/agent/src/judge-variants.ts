import Anthropic from '@anthropic-ai/sdk';
import { JUDGE_VARIANTS_PROMPT } from './prompts.js';
import { parseVerdict, JUDGE_REQUEST_TUNING, JudgeUnavailableError, isJudgeUnavailable, type JudgeVerdict } from './judge.js';
import type { Variant } from './types.js';
import { JUDGE_MODEL } from './models.js';
import { recordUsage } from './usage.js';

export async function judgeVariantArray(opts: {
  screenshot: Buffer;
  variants: Variant[];
  apiKey: string;
  model?: string;
}): Promise<JudgeVerdict> {
  const client = new Anthropic({ apiKey: opts.apiKey });
  try {
    const res = await client.messages.create({
      model: opts.model ?? JUDGE_MODEL,
      ...JUDGE_REQUEST_TUNING,
      system: JUDGE_VARIANTS_PROMPT,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: opts.screenshot.toString('base64') } },
          { type: 'text', text: `Extracted variants (${opts.variants.length} entries):\n${JSON.stringify(opts.variants, null, 2)}` },
        ],
      }],
    });
    recordUsage(opts.model ?? JUDGE_MODEL, res.usage);
    const text = res.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') {
      console.error(`[judge-variants] no text block (stop_reason=${res.stop_reason}, blocks=${res.content.map((b) => b.type).join(',') || 'none'})`);
      return 'error';
    }
    return parseVerdict(text.text);
  } catch (err) {
    // A run-ending failure (no credit, bad key) must not be folded into the
    // verdict counts — it will recur on every field and is not a measurement.
    if (isJudgeUnavailable(err)) {
      throw new JudgeUnavailableError(err instanceof Error ? err.message : String(err));
    }
    console.error('[judge-variants] error:', err);
    return 'error';
  }
}
