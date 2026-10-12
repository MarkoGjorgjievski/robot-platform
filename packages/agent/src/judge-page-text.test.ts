// The judge's request with and without the page's visible text, and with a
// value cut short. The Anthropic client is mocked: no model call, free, offline.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const create = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class { messages = { create }; },
}));

const { judgeFieldExtraction, pageTextHeading, PAGE_TEXT_LIMIT, TRUNCATED_NOTE } = await import('./judge.js');

type Block = { type: string; text?: string };
const lastRequest = () => create.mock.calls.at(-1)![0] as { system: string; messages: Array<{ content: Block[] }> };
const png = Buffer.from('not-a-real-png');

beforeEach(() => {
  create.mockReset();
  create.mockResolvedValue({
    content: [{ type: 'text', text: 'correct' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 1 },
  });
});

describe('judgeFieldExtraction — page text', () => {
  it('sends the page text as a text block before the image when given', async () => {
    const verdict = await judgeFieldExtraction({ screenshot: png, field: 'Price', value: 910, apiKey: 'k', pageText: 'Diamond Hoops MYR 910' });
    expect(verdict).toBe('correct');
    const { system, messages } = lastRequest();
    const content = messages[0]!.content;
    expect(content.map((b) => b.type)).toEqual(['text', 'image', 'text']);
    expect(content[0]!.text).toBe(`${pageTextHeading('start')}\nDiamond Hoops MYR 910`);
    expect(content[2]!.text).toBe('Field: Price\nExtracted value: 910');
    expect(system).toContain("A value that the page text shows as THIS product's value for the field is correct even when the screenshot hides it (folded text, a star widget, a currency prefix).");
    expect(system).toMatch(/appears in the text only for something else — another product, a shipping threshold, a size, another variant — is wrong\.$/);
  });

  it('says which part of the page the text is', async () => {
    expect(pageTextHeading('excerpt')).toContain('an excerpt around the value');
    expect(pageTextHeading('start')).toContain('the start of the page');
    await judgeFieldExtraction({ screenshot: png, field: 'Price', value: 910, apiKey: 'k', pageText: '… MYR 910 …', pageTextKind: 'excerpt' });
    expect(lastRequest().messages[0]!.content[0]!.text).toMatch(/^The page's visible text, an excerpt around the value/);
  });

  it('caps the page text at the first 8,000 characters', async () => {
    const long = 'a'.repeat(PAGE_TEXT_LIMIT) + 'TAIL';
    await judgeFieldExtraction({ screenshot: png, field: 'Description', value: 'x', apiKey: 'k', pageText: long });
    const text = lastRequest().messages[0]!.content[0]!.text!;
    expect(PAGE_TEXT_LIMIT).toBe(8_000);
    expect(text).toBe(`${pageTextHeading('start')}\n${'a'.repeat(PAGE_TEXT_LIMIT)}`);
    expect(text).not.toContain('TAIL');
  });

  it('sends no text block and the calibrated prompt unchanged without page text', async () => {
    await judgeFieldExtraction({ screenshot: png, field: 'Price', value: 910, apiKey: 'k' });
    const { system, messages } = lastRequest();
    expect(messages[0]!.content.map((b) => b.type)).toEqual(['image', 'text']);
    expect(JSON.stringify(messages)).not.toContain("The page's visible text");
    expect(system).not.toMatch(/page text|cut short/);
    expect(system).toMatch(/No explanation\.$/);
  });

  it('treats blank page text as none', async () => {
    await judgeFieldExtraction({ screenshot: png, field: 'Price', value: 910, apiKey: 'k', pageText: '   ' });
    expect(lastRequest().messages[0]!.content.map((b) => b.type)).toEqual(['image', 'text']);
  });
});

describe('judgeFieldExtraction — a value cut short', () => {
  it('says so in the user message and the prompt', async () => {
    const cut = `${'Soft seamless leggings '.repeat(4).slice(0, 80)}…`;
    await judgeFieldExtraction({ screenshot: png, field: 'Description', value: cut, apiKey: 'k', pageText: 'x', valueTruncated: true });
    const { system, messages } = lastRequest();
    expect(messages[0]!.content[2]!.text).toBe(`Field: Description\nExtracted value: ${JSON.stringify(cut)}\n${TRUNCATED_NOTE}`);
    expect(TRUNCATED_NOTE).toMatch(/first 80 characters/);
    expect(system).toMatch(/cut short and ending in "…" is correct when the part shown matches/);
  });

  it('says nothing about it otherwise', async () => {
    await judgeFieldExtraction({ screenshot: png, field: 'Description', value: 'short', apiKey: 'k', pageText: 'x' });
    const { system, messages } = lastRequest();
    expect(messages[0]!.content[2]!.text).not.toContain(TRUNCATED_NOTE);
    expect(system).not.toMatch(/cut short/);
  });
});
