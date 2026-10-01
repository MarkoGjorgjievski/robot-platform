import { describe, it, expect } from 'vitest';
import {
  METHOD_LABELS,
  axesFor,
  axisLabel,
  axisPlural,
  setLine,
  summaryLines,
  variantsStepState,
  type DetectResult,
  type DetectedPage,
} from './variants-view';

const page = (n: number, over: Partial<DetectedPage> = {}): DetectedPage => ({
  url: `https://shop.example/p/${n}`,
  captured: true,
  lists: [],
  links: [],
  pickers: [],
  ...over,
});

const colourList = (colours: string[]) => ({
  source: 'json-ld' as const,
  path: 'hasVariant',
  count: colours.length,
  axes: ['color'],
  entries: colours.map((c, i) => ({ color: c, sku: `S${i}` })),
});

const colourLinks = (labels: string[]) => ({
  container: 'div.colour-swatches',
  count: labels.length,
  links: labels.map((l) => ({ href: `https://shop.example/p/1-${l.toLowerCase()}`, label: l })),
});

/** A list on products 1 and 2, none on product 3. */
const listOnTwo: DetectResult = {
  pages: [page(1, { lists: [colourList(['Red', 'Blue'])] }), page(2, { lists: [colourList(['Red', 'Green'])] }), page(3)],
  suggested: 'list',
};

/** Four colour links on every product. */
const linksOnAll: DetectResult = {
  pages: [1, 2, 3].map((n) => page(n, { links: [colourLinks(['Red', 'Blue', 'Green', 'Black'])] })),
  suggested: 'links',
};

/** Sizes only in a picker: no list, no links name them. */
const pickerOnlySizes: DetectResult = {
  pages: [1, 2, 3].map((n) => page(n, { pickers: [{ axis: 'size', options: ['S', 'M', 'L'] }] })),
  suggested: 'none',
};

describe('axis words', () => {
  it('names an axis in plain words, singular and plural', () => {
    expect(axisPlural('color')).toBe('colours');
    expect(axisPlural('colour')).toBe('colours');
    expect(axisPlural('size')).toBe('sizes');
    expect(axisPlural('option1')).toBe('options');
    expect(axisPlural('option3')).toBe('options');
    expect(axisPlural('length')).toBe('lengths');
    expect(axisLabel('color')).toBe('Colour');
    expect(axisLabel('size')).toBe('Size');
    expect(axisLabel('option2')).toBe('Option 2');
    expect(axisLabel('material')).toBe('Material');
  });
});

describe('summaryLines', () => {
  it('a list on two of three products', () => {
    expect(summaryLines(listOnTwo)).toEqual(['Listed in the page data: 2 colours on product 1, 2 on product 2, none on product 3']);
  });

  it('the same list on every product is said once', () => {
    const d: DetectResult = { pages: [1, 2, 3].map((n) => page(n, { lists: [colourList(['Red', 'Blue'])] })), suggested: 'list' };
    expect(summaryLines(d)).toEqual(['Listed in the page data: 2 colours on every product']);
  });

  it('links on all three', () => {
    expect(summaryLines(linksOnAll)).toEqual(['Linked as separate pages: 4 colour links per product']);
  });

  it('links on some products are counted per product', () => {
    const d: DetectResult = { pages: [page(1, { links: [colourLinks(['Red', 'Blue'])] }), page(2)], suggested: 'links' };
    expect(summaryLines(d)).toEqual(['Linked as separate pages: 2 colour links on product 1, none on product 2']);
  });

  it('picker-only sizes', () => {
    expect(summaryLines(pickerOnlySizes)).toEqual(['Only in a picker on the page: sizes — not collected in this version']);
  });

  it('a picker whose choices are also in the page data is not picker-only', () => {
    const d: DetectResult = {
      pages: [page(1, { lists: [colourList(['Red', 'Blue'])], pickers: [{ axis: 'colour', options: ['Red', 'Blue'] }] })],
      suggested: 'list',
    };
    expect(summaryLines(d)).toEqual(['Listed in the page data: 2 colours on every product']);
  });

  it('a product without a screenshot is said so', () => {
    const d: DetectResult = { pages: [page(1, { lists: [colourList(['Red', 'Blue'])] }), page(2, { captured: false })], suggested: 'list' };
    expect(summaryLines(d)).toEqual(['Listed in the page data: 2 colours on product 1, not checked on product 2']);
  });

  it('nothing found', () => {
    expect(summaryLines({ pages: [page(1), page(2)], suggested: 'none' })).toEqual(['No variants found on these products']);
  });
});

describe('axesFor', () => {
  it('the list method offers the list axes with their options', () => {
    expect(axesFor(listOnTwo, 'list')).toEqual([{ from: 'color', label: 'Colour', options: ['Red', 'Blue', 'Green'] }]);
  });
  it('the links method offers the link group named by its container', () => {
    expect(axesFor(linksOnAll, 'links')).toEqual([{ from: 'colour', label: 'Colour', options: ['Red', 'Blue', 'Green', 'Black'] }]);
  });
  it('no variants offers nothing', () => {
    expect(axesFor(listOnTwo, 'none')).toEqual([]);
  });
});

describe('variantsStepState', () => {
  const base = { mode: 'row_per_variant', cards: 3, detection: listOnTwo, setup: null, axes: [] };

  it('off when the project ignores variants', () => {
    expect(variantsStepState({ ...base, mode: 'ignore' })).toEqual({ kind: 'off' });
  });

  it('mode on, no products: find products first (Review Focus 1)', () => {
    expect(variantsStepState({ ...base, cards: 0, detection: null })).toEqual({ kind: 'no-pages', reason: 'Find products first' });
  });

  it('products but no screenshots yet: wait for them (Review Focus 1)', () => {
    expect(variantsStepState({ ...base, detection: null })).toEqual({ kind: 'no-pages', reason: 'Wait for the screenshots' });
    const none = { pages: [page(1, { captured: false })], suggested: 'none' as const };
    expect(variantsStepState({ ...base, detection: none })).toEqual({ kind: 'no-pages', reason: 'Wait for the screenshots' });
  });

  it('found: summary, suggestion, axes and picker-only words', () => {
    expect(variantsStepState(base)).toEqual({
      kind: 'found',
      summary: ['Listed in the page data: 2 colours on product 1, 2 on product 2, none on product 3'],
      suggested: 'list',
      axes: [{ from: 'color', label: 'Colour', options: ['Red', 'Blue', 'Green'] }],
      pickerOnly: [],
    });
    const p = variantsStepState({ ...base, detection: pickerOnlySizes });
    expect(p).toMatchObject({ kind: 'found', suggested: 'none', axes: [], pickerOnly: ['sizes'] });
  });

  it('set: the stored method with each axis named by its project column', () => {
    const setup = { method: 'links' as const, axes: [{ from: 'colour', axisKey: 'colour' }], confirmedAt: '2026-10-01T00:00:00Z' };
    const s = variantsStepState({ ...base, setup, axes: [{ key: 'colour', name: 'Colour' }] });
    expect(s).toEqual({ kind: 'set', method: 'links', axes: [{ from: 'colour', axisName: 'Colour' }] });
    expect(setLine(s as Extract<typeof s, { kind: 'set' }>)).toBe('Variants: linked as separate pages · Colour');
    expect(setLine({ kind: 'set', method: 'none', axes: [] })).toBe('Variants: none on this website');
  });

  it('the method labels are the customer words', () => {
    expect(METHOD_LABELS).toEqual({ list: 'Listed in the page data', links: 'Linked as separate pages', none: 'No variants on this website' });
  });
});
