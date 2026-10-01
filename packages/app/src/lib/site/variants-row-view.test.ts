import { describe, it, expect } from 'vitest';
import { variantCells, confirmAnswer, spotRows, variantsNeed, variantNoun, extractEnabled, type VariantAnswer, type VariantResultView } from './variants-row-view';
import type { DetectResult } from './variants-view';

const U = ['https://shop.example/a', 'https://shop.example/b', 'https://shop.example/c'];

function page(url: string, over: Partial<DetectResult['pages'][number]> = {}): DetectResult['pages'][number] {
  return { url, captured: true, lists: [], links: [], pickers: [], ...over };
}

function detection(pages: DetectResult['pages']): DetectResult {
  return { pages, suggested: 'list' };
}

describe('variantNoun', () => {
  it('is the lower-cased first axis name plus "s"', () => {
    expect(variantNoun(['Colour'])).toBe('colours');
  });
  it('is "variants" with no mapped axis', () => {
    expect(variantNoun([])).toBe('variants');
  });
});

describe('variantCells', () => {
  const base = { method: 'list' as const, urls: U, detection: null as DetectResult | null, answers: {}, result: null as VariantResultView | null, resultCurrent: false, noun: 'colours' };

  it('waiting: no capture yet', () => {
    const d = detection([page(U[0]!, { captured: false }), page(U[1]!), page(U[2]!)]);
    const cells = variantCells({ ...base, detection: d });
    expect(cells[U[0]!]).toEqual({ kind: 'waiting', text: 'Waiting for the screenshot' });
  });

  it('found: captured, a list with entries, not yet confirmed', () => {
    const d = detection([page(U[0]!, { lists: [{ source: 'json-ld', path: 'offers', count: 2, axes: ['colour'], entries: [{ colour: 'Black' }, { colour: 'Red' }] }] })]);
    const cells = variantCells({ ...base, urls: [U[0]!], detection: d });
    expect(cells[U[0]!]).toEqual({ kind: 'found', text: '2 colours', labels: ['Black', 'Red'] });
  });

  it('none-found: captured, nothing found', () => {
    const d = detection([page(U[0]!)]);
    const cells = variantCells({ ...base, urls: [U[0]!], detection: d });
    expect(cells[U[0]!]).toEqual({ kind: 'none-found', text: 'No variants' });
  });

  it('confirmed: an answer with variants', () => {
    const answers: Record<string, VariantAnswer> = { [U[0]!]: { count: 2, labels: ['Black', 'Red'] } };
    const cells = variantCells({ ...base, urls: [U[0]!], answers });
    expect(cells[U[0]!]).toEqual({ kind: 'confirmed', text: '2 colours', labels: ['Black', 'Red'] });
  });

  it('confirmed-none: an answer of zero', () => {
    const answers: Record<string, VariantAnswer> = { [U[0]!]: { count: 0, labels: [] } };
    const cells = variantCells({ ...base, urls: [U[0]!], answers });
    expect(cells[U[0]!]).toEqual({ kind: 'confirmed-none', text: 'No variants on this product' });
  });

  it('failed: a current result that failed this page', () => {
    const result: VariantResultView = { passed: false, pages: { [U[0]!]: { status: 'fail', message: 'found 1 of 2 colours on product 1' } } };
    const cells = variantCells({ ...base, urls: [U[0]!], result, resultCurrent: true });
    expect(cells[U[0]!]).toEqual({ kind: 'failed', text: 'found 1 of 2 colours on product 1' });
  });

  it('a stale (non-current) failure shows the answer, not the failure', () => {
    const result: VariantResultView = { passed: false, pages: { [U[0]!]: { status: 'fail', message: 'found 1 of 2 colours on product 1' } } };
    const answers: Record<string, VariantAnswer> = { [U[0]!]: { count: 2, labels: ['Black', 'Red'] } };
    const cells = variantCells({ ...base, urls: [U[0]!], answers, result, resultCurrent: false });
    expect(cells[U[0]!]).toEqual({ kind: 'confirmed', text: '2 colours', labels: ['Black', 'Red'] });
  });

  it('a stale failure with no answer falls through to the capture', () => {
    const d = detection([page(U[0]!)]);
    const result: VariantResultView = { passed: false, pages: { [U[0]!]: { status: 'fail', message: 'found 1 of 2 colours on product 1' } } };
    const cells = variantCells({ ...base, urls: [U[0]!], detection: d, result, resultCurrent: false });
    expect(cells[U[0]!]).toEqual({ kind: 'none-found', text: 'No variants' });
  });
});

describe('confirmAnswer', () => {
  it('list: labels from colours', () => {
    const p = page(U[0]!, { lists: [{ source: 'json-ld', path: 'offers', count: 2, axes: ['colour'], entries: [{ colour: 'Black' }, { colour: 'Red' }] }] });
    expect(confirmAnswer('list', p, undefined)).toEqual({ count: 2, labels: ['Black', 'Red'], list: { source: 'json-ld', path: 'offers' } });
  });

  it('list: falls back to the sku when there is no axis value', () => {
    const p = page(U[0]!, { lists: [{ source: 'api', path: 'variants', count: 1, axes: [], entries: [{ sku: 'ABC-1' }] }] });
    expect(confirmAnswer('list', p, undefined)).toEqual({ count: 1, labels: ['ABC-1'], list: { source: 'api', path: 'variants' } });
  });

  it('list: nothing found returns an empty answer', () => {
    expect(confirmAnswer('list', page(U[0]!), undefined)).toEqual({ count: 0, labels: [] });
  });

  it('list: falls back to a 1-based placeholder with no axis value and no sku', () => {
    const p = page(U[0]!, { lists: [{ source: 'api', path: 'variants', count: 2, axes: ['colour'], entries: [{}, {}] }] });
    expect(confirmAnswer('list', p, undefined)).toEqual({ count: 2, labels: ['Variant 1', 'Variant 2'], list: { source: 'api', path: 'variants' } });
  });

  it('links: picks the first link that is not the page itself', () => {
    const p = page(U[0]!, { links: [{ container: 'swatches', count: 2, links: [{ href: U[0]!, label: 'Black' }, { href: U[1]!, label: 'Red' }] }] });
    expect(confirmAnswer('links', p, undefined)).toEqual({
      count: 2, labels: ['Black', 'Red'], links: [U[0]!, U[1]!],
      spot: { index: 0, url: U[1]!, expected: {} },
    });
  });

  it('links: every link is the page itself, uses the first one', () => {
    const p = page(U[0]!, { links: [{ container: 'swatches', count: 1, links: [{ href: U[0]!, label: 'Black' }] }] });
    expect(confirmAnswer('links', p, undefined)).toEqual({
      count: 1, labels: ['Black'], links: [U[0]!],
      spot: { index: 0, url: U[0]!, expected: {} },
    });
  });

  it('links: nothing found returns an empty answer', () => {
    expect(confirmAnswer('links', page(U[0]!), undefined)).toEqual({ count: 0, labels: [] });
  });

  it('links: a trailing-slash self-link is still recognised as the page itself', () => {
    const proofUrl = 'https://shop.example/products/shoe';
    const selfWithSlash = 'https://shop.example/products/shoe/';
    const redUrl = 'https://shop.example/products/shoe-red';
    const p = page(proofUrl, { links: [{ container: 'swatches', count: 2, links: [{ href: selfWithSlash, label: 'Blue' }, { href: redUrl, label: 'Red' }] }] });
    const answer = confirmAnswer('links', p, undefined);
    expect(answer.spot?.url).toBe(redUrl);
  });

  it('keeps the spot when the count and list are unchanged (list method)', () => {
    const p = page(U[0]!, { lists: [{ source: 'json-ld', path: 'offers', count: 2, axes: ['colour'], entries: [{ colour: 'Black' }, { colour: 'Red' }] }] });
    const current: VariantAnswer = { count: 2, labels: ['Black', 'Red'], list: { source: 'json-ld', path: 'offers' }, spot: { index: 0, expected: { colour: 'Black' } } };
    expect(confirmAnswer('list', p, current)).toEqual({ ...current });
  });

  it('drops the spot when the list changed (list method)', () => {
    const p = page(U[0]!, { lists: [{ source: 'json-ld', path: 'offers', count: 3, axes: ['colour'], entries: [{ colour: 'Black' }, { colour: 'Red' }, { colour: 'Blue' }] }] });
    const current: VariantAnswer = { count: 2, labels: ['Black', 'Red'], list: { source: 'json-ld', path: 'offers' }, spot: { index: 0, expected: { colour: 'Black' } } };
    expect(confirmAnswer('list', p, current).spot).toBeUndefined();
  });

  it('keeps the spot when the count and links are unchanged (links method)', () => {
    const p = page(U[0]!, { links: [{ container: 'swatches', count: 2, links: [{ href: U[0]!, label: 'Black' }, { href: U[1]!, label: 'Red' }] }] });
    const current: VariantAnswer = { count: 2, labels: ['Black', 'Red'], links: [U[0]!, U[1]!], spot: { index: 0, url: U[1]!, expected: { colour: 'Red' } } };
    expect(confirmAnswer('links', p, current)).toEqual({ count: 2, labels: ['Black', 'Red'], links: [U[0]!, U[1]!], spot: current.spot });
  });
});

describe('spotRows', () => {
  const fields = [{ key: 'colour', name: 'Colour' }, { key: 'material', name: 'Material' }];

  it('from-product: listed in fromProduct', () => {
    const answer: VariantAnswer = { count: 1, labels: ['Black'], spot: { index: 0, expected: {}, fromProduct: ['material'] } };
    const rows = spotRows({ fields, suggestions: null, answer });
    expect(rows.find((r) => r.key === 'material')).toEqual({ key: 'material', name: 'Material', state: 'from-product' });
  });

  it('confirmed: expected[key] is set', () => {
    const answer: VariantAnswer = { count: 1, labels: ['Black'], spot: { index: 0, expected: { colour: 'Black' } } };
    const rows = spotRows({ fields, suggestions: null, answer });
    expect(rows.find((r) => r.key === 'colour')).toEqual({ key: 'colour', name: 'Colour', state: 'confirmed', value: 'Black' });
  });

  it('suggested: there is a suggestion and nothing confirmed', () => {
    const rows = spotRows({ fields, suggestions: { colour: { value: 'Black', path: 'colour' } }, answer: undefined });
    expect(rows.find((r) => r.key === 'colour')).toEqual({ key: 'colour', name: 'Colour', state: 'suggested', suggestion: { value: 'Black', path: 'colour' } });
  });

  it('needs-you: nothing confirmed and no suggestion', () => {
    const rows = spotRows({ fields, suggestions: { colour: null }, answer: undefined });
    expect(rows.find((r) => r.key === 'colour')).toEqual({ key: 'colour', name: 'Colour', state: 'needs-you' });
  });
});

describe('variantsNeed', () => {
  const base = { urls: U, answers: {} as Record<string, VariantAnswer>, method: 'list' as const, entryFieldKeys: ['colour'] };

  it('none: variants null', () => {
    expect(variantsNeed({ ...base, variants: null })).toEqual({ kind: 'none' });
  });

  it('blocked: setup missing', () => {
    expect(variantsNeed({ ...base, variants: { required: 'setup-missing', current: false, passed: false } })).toEqual({
      kind: 'blocked', reason: "Set up this website's variants below",
    });
  });

  it('blocked: a url has no answer', () => {
    const answers: Record<string, VariantAnswer> = { [U[0]!]: { count: 0, labels: [] } };
    expect(variantsNeed({ ...base, answers, variants: { required: 'yes', current: false, passed: false } })).toEqual({
      kind: 'blocked', reason: 'Confirm the variants of every product',
    });
  });

  it('blocked: product 2 has a confirmed variant with an unchecked entry field', () => {
    const answers: Record<string, VariantAnswer> = {
      [U[0]!]: { count: 1, labels: ['Black'], spot: { index: 0, expected: { colour: 'Black' } } },
      [U[1]!]: { count: 1, labels: ['Red'] },
      [U[2]!]: { count: 0, labels: [] },
    };
    expect(variantsNeed({ ...base, answers, variants: { required: 'yes', current: false, passed: false } })).toEqual({
      kind: 'blocked', reason: 'Check one variant of product 2',
    });
  });

  it('pending: every answer present and checked, not current', () => {
    const answers: Record<string, VariantAnswer> = {
      [U[0]!]: { count: 1, labels: ['Black'], spot: { index: 0, expected: { colour: 'Black' } } },
      [U[1]!]: { count: 1, labels: ['Red'], spot: { index: 0, expected: { colour: 'Red' } } },
      [U[2]!]: { count: 0, labels: [] },
    };
    expect(variantsNeed({ ...base, answers, variants: { required: 'yes', current: false, passed: false } })).toEqual({ kind: 'pending' });
  });

  it('done: current', () => {
    const answers: Record<string, VariantAnswer> = {
      [U[0]!]: { count: 1, labels: ['Black'], spot: { index: 0, expected: { colour: 'Black' } } },
      [U[1]!]: { count: 1, labels: ['Red'], spot: { index: 0, expected: { colour: 'Red' } } },
      [U[2]!]: { count: 0, labels: [] },
    };
    expect(variantsNeed({ ...base, answers, variants: { required: 'yes', current: true, passed: true } })).toEqual({ kind: 'done' });
  });

  it('links method skips the entry-field spot check', () => {
    const answers: Record<string, VariantAnswer> = {
      [U[0]!]: { count: 1, labels: ['Black'], links: [U[0]!] },
      [U[1]!]: { count: 1, labels: ['Red'], links: [U[1]!] },
      [U[2]!]: { count: 0, labels: [] },
    };
    expect(variantsNeed({ ...base, method: 'links', answers, variants: { required: 'yes', current: false, passed: false } })).toEqual({ kind: 'pending' });
  });
});

describe('extractEnabled', () => {
  it('locked until fields are current and passed', () => {
    expect(extractEnabled({ current: false, allPassed: true, variants: null })).toBe(false);
    expect(extractEnabled({ current: true, allPassed: false, variants: null })).toBe(false);
  });

  it('unlocked with fields done and variants null (ignore mode)', () => {
    expect(extractEnabled({ current: true, allPassed: true, variants: null })).toBe(true);
  });

  it('locked until variants are current and passed', () => {
    expect(extractEnabled({ current: true, allPassed: true, variants: { current: false, passed: false } })).toBe(false);
    expect(extractEnabled({ current: true, allPassed: true, variants: { current: true, passed: false } })).toBe(false);
  });

  it('unlocked once variants are done and passed', () => {
    expect(extractEnabled({ current: true, allPassed: true, variants: { current: true, passed: true } })).toBe(true);
  });
});
