// The judge's request with and without the page's visible text. The Anthropic
// client is mocked: no model call, free, offline.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const create = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class { messages = { create }; },
}));

const { judgeFieldExtraction, PAGE_TEXT_HEADING, PAGE_TEXT_LIMIT } = await import('./judge.js');

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
    expect(content[0]!.text).toBe(`${PAGE_TEXT_HEADING}\nDiamond Hoops MYR 910`);
    expect(content[2]!.text).toContain('Extracted value: 910');
    expect(system).toMatch(/hidden or abbreviated in the screenshot/);
    expect(system).toMatch(/is correct\.$/);
  });

  it('caps the page text at the first 8,000 characters', async () => {
    const long = 'a'.repeat(PAGE_TEXT_LIMIT) + 'TAIL';
    await judgeFieldExtraction({ screenshot: png, field: 'Description', value: 'x', apiKey: 'k', pageText: long });
    const text = lastRequest().messages[0]!.content[0]!.text!;
    expect(PAGE_TEXT_LIMIT).toBe(8_000);
    expect(text).toBe(`${PAGE_TEXT_HEADING}\n${'a'.repeat(PAGE_TEXT_LIMIT)}`);
    expect(text).not.toContain('TAIL');
  });

  it('sends no text block and the calibrated prompt unchanged without page text', async () => {
    await judgeFieldExtraction({ screenshot: png, field: 'Price', value: 910, apiKey: 'k' });
    const { system, messages } = lastRequest();
    expect(messages[0]!.content.map((b) => b.type)).toEqual(['image', 'text']);
    expect(JSON.stringify(messages)).not.toContain(PAGE_TEXT_HEADING);
    expect(system).not.toMatch(/page text/);
    expect(system).toMatch(/No explanation\.$/);
  });

  it('treats blank page text as none', async () => {
    await judgeFieldExtraction({ screenshot: png, field: 'Price', value: 910, apiKey: 'k', pageText: '   ' });
    expect(lastRequest().messages[0]!.content.map((b) => b.type)).toEqual(['image', 'text']);
  });
});
