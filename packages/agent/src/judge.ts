import Anthropic from '@anthropic-ai/sdk';
import { JUDGE_MODEL } from './models.js';

export type JudgeVerdict = 'correct' | 'wrong' | 'not-on-page' | 'error';

const SYSTEM = `You judge whether an extracted field value is correct on a webpage. You are shown a screenshot of the page, the field name, and the extracted value. Reply with EXACTLY one word: "correct" (the value is right), "wrong" (a value is visible on the page for this field but it's different from what was extracted), or "not-on-page" (the value the field would have is not visible on the page at all). No explanation.`;

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
    const t = text.text.trim().toLowerCase();
    if (t.startsWith('correct')) return 'correct';
    if (t.startsWith('wrong')) return 'wrong';
    if (t.startsWith('not')) return 'not-on-page';
    return 'error';
  } catch (err) {
    console.error('[judge] error:', err);
    return 'error';
  }
}
