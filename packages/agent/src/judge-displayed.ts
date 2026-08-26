import Anthropic from '@anthropic-ai/sdk';
import { JUDGE_MODEL } from './models.js';
import { JUDGE_REQUEST_TUNING } from './judge.js';
import { recordUsage } from './usage.js';

/**
 * Plain `{label, value}` candidates only — NOT `@robot/scraper`'s `Candidate`
 * type. This package must never import from `@robot/scraper`: scraper already
 * depends on agent, and an agent→scraper import would create a cycle.
 */
export type DisplayedCandidate = { label: string; value: unknown };

const SYSTEM = `You judge which candidate value, if any, a webpage screenshot visibly displays to a shopper for the MAIN PRODUCT on the page. You are shown a screenshot of the page, the concept, and a list of labelled candidate values. Reply with EXACTLY \`DISPLAYED: <label>\` naming the one candidate whose value the page visibly shows for the main product itself, or \`DISPLAYED: NONE\` if none of the candidates is what the page shows for it. No explanation.`;

/**
 * The prompt offering every candidate and demanding the DISPLAYED: sentinel.
 * Pure — no network, no client.
 *
 * The main-product scoping is load-bearing: on 2026-08-26 the unscoped
 * question marked Target's displayed price as the $50 protection-plan add-on,
 * which IS visible on the page — a wrong-entity value the vision check exists
 * to rule out, not to certify.
 */
export function buildDisplayedPrompt(concept: string, candidates: DisplayedCandidate[]): string {
  const lines = candidates.map((c) => `- ${c.label}: ${JSON.stringify(c.value)}`).join('\n');
  return [
    `Which of these candidate values, if any, is what this page visibly shows a shopper for the main product's ${concept}?`,
    '',
    lines,
    '',
    'Only the main product counts. A value belonging to a protection plan, warranty, accessory,',
    'bundle, add-on, shipping offer, or another product on the page is NOT the answer, even when visible.',
    'If only such values match, answer NONE.',
    '',
    'Answer exactly `DISPLAYED: <label>` or `DISPLAYED: NONE`.',
  ].join('\n');
}

/**
 * Parse the model's reply into a label or null.
 *
 * Validates the named label against the labels actually offered — a
 * hallucinated label (one the model invented rather than named from the
 * list) must not stick, so it is treated the same as NONE.
 */
export function parseDisplayedVerdict(text: string, labels: string[]): string | null {
  const match = text.match(/DISPLAYED:\s*([\w-]+)/);
  if (!match) return null;
  const label = match[1]!;
  if (label.toUpperCase() === 'NONE') return null;
  return labels.includes(label) ? label : null;
}

/**
 * Ask the judge which candidate the page visibly displays.
 *
 * Returns `null` on ANY error — bad key, exhausted credit, malformed
 * response, network failure. This is a best-effort verification signal, not
 * a gate: a judge outage must degrade to "no displayed candidate marked",
 * never abort the caller.
 */
export async function judgeDisplayedCandidate(opts: {
  screenshot: Buffer;
  concept: string;
  candidates: DisplayedCandidate[];
  apiKey: string;
  model?: string;
}): Promise<string | null> {
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
          { type: 'text', text: buildDisplayedPrompt(opts.concept, opts.candidates) },
        ],
      }],
    });
    recordUsage(opts.model ?? JUDGE_MODEL, res.usage);
    const text = res.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') {
      console.error(
        `[judge-displayed] no text block for ${opts.concept} (stop_reason=${res.stop_reason}, blocks=${res.content.map((b) => b.type).join(',') || 'none'})`,
      );
      return null;
    }
    return parseDisplayedVerdict(text.text, opts.candidates.map((c) => c.label));
  } catch (err) {
    console.error('[judge-displayed] error:', err);
    return null;
  }
}
