import Anthropic from '@anthropic-ai/sdk';
import { JUDGE_VARIANTS_PROMPT } from './prompts.js';
import { parseVerdict, type JudgeVerdict } from './judge.js';
import type { Variant } from './types.js';
import { JUDGE_MODEL } from './models.js';

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
      max_tokens: 16,
      system: JUDGE_VARIANTS_PROMPT,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: opts.screenshot.toString('base64') } },
          { type: 'text', text: `Extracted variants (${opts.variants.length} entries):\n${JSON.stringify(opts.variants, null, 2)}` },
        ],
      }],
    });
    const text = res.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') return 'error';
    return parseVerdict(text.text);
  } catch (err) {
    console.error('[judge-variants] error:', err);
    return 'error';
  }
}
