import Anthropic from '@anthropic-ai/sdk';
import { JUDGE_VARIANTS_PROMPT } from './prompts.js';
import type { JudgeVerdict } from './judge.js';
import type { Variant } from './types.js';

export async function judgeVariantArray(opts: {
  screenshot: Buffer;
  variants: Variant[];
  apiKey: string;
  model?: string;
}): Promise<JudgeVerdict> {
  const client = new Anthropic({ apiKey: opts.apiKey });
  try {
    const res = await client.messages.create({
      model: opts.model ?? 'claude-sonnet-4-20250514',
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
    const t = text.text.trim().toLowerCase();
    if (t.startsWith('correct')) return 'correct';
    if (t.startsWith('wrong')) return 'wrong';
    if (t.startsWith('not')) return 'not-on-page';
    return 'error';
  } catch (err) {
    console.error('[judge-variants] error:', err);
    return 'error';
  }
}
