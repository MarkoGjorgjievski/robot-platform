import Anthropic from '@anthropic-ai/sdk';
import { JUDGE_MODEL } from './models.js';
import { recordUsage } from './usage.js';
import { JUDGE_REQUEST_TUNING } from './judge.js';

// A follow-up to a `wrong` verdict from judgeFieldExtraction, which answers in
// one word by design (its prompt is calibrated; do not add a reason to it).
// This separate call asks what the page shows instead, so a report can say
// "extracted 24.99, page shows 19.99" rather than just "wrong". Only called
// on wrong verdicts, so it adds roughly one judge call per wrong value.
const SYSTEM = `You are shown a screenshot of a webpage, a field name, and a value that was extracted for that field but judged wrong. In one short sentence, say what value the page actually shows for this field. If the page shows no value for it, say so. No preamble.`;

export async function explainWrongValue(opts: {
  screenshot: Buffer;
  field: string;
  value: unknown;
  apiKey: string;
  model?: string;
}): Promise<string | null> {
  const client = new Anthropic({ apiKey: opts.apiKey });
  const model = opts.model ?? JUDGE_MODEL;
  try {
    const res = await client.messages.create({
      model,
      ...JUDGE_REQUEST_TUNING,
      max_tokens: 120,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: opts.screenshot.toString('base64') } },
          { type: 'text', text: `Field: ${opts.field}\nExtracted value: ${JSON.stringify(opts.value)}` },
        ],
      }],
    });
    recordUsage(model, res.usage);
    const text = res.content.find((b) => b.type === 'text');
    return text && text.type === 'text' ? text.text.trim() : null;
  } catch (err) {
    console.error('[judge-explain] error:', err);
    return null;
  }
}
