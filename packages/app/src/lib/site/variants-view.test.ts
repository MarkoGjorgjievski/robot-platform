import { describe, it, expect } from 'vitest';
import {
  METHOD_LABELS,
  NEW_COLUMN,
  axisMappings,
  defaultTarget,
  newColumnName,
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

  it('plurals every one of the twelve known words exactly, not by mechanically adding "s"', () => {
    const plurals: Record<string, string> = {
      colour: 'colours',
      size: 'sizes',
      length: 'lengths',
      width: 'widths',
      height: 'heights',
      material: 'materials',
      pattern: 'patterns',
      style: 'styles',
      capacity: 'capacities',
      flavour: 'flavours',
      scent: 'scents',
      finish: 'finishes',
    };
    for (const [singular, plural] of Object.entries(plurals)) {
      expect(axisPlural(singular)).toBe(plural);
      expect(axisPlural(singular.replace(/^colour$/, 'color').replace(/^flavour$/, 'flavor'))).toBe(plural);
    }
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

  it('picker words that are not on the known list are left out', () => {
    const d: DetectResult = {
      pages: [page(1, { pickers: [{ axis: 'swatch', options: ['Red'] }, { axis: 'defaultColorNames', options: ['Red'] }, { axis: 'colour', options: ['Red', 'Blue'] }] })],
      suggested: 'none',
    };
    expect(summaryLines(d)).toEqual(['Only in a picker on the page: colours — not collected in this version']);
  });

  it('picker-only capacity and finish use their exact plurals, not "capacitys"/"finishs"', () => {
    const d: DetectResult = {
      pages: [page(1, { pickers: [{ axis: 'capacity', options: ['1L'] }, { axis: 'finish', options: ['Matte'] }] })],
      suggested: 'none',
    };
    expect(summaryLines(d)).toEqual(['Only in a picker on the page: capacities, finishes — not collected in this version']);
  });

  it('no picker line when no known word is left', () => {
    const d: DetectResult = {
      pages: [page(1, { pickers: [{ axis: 'swatch', options: ['Red'] }, { axis: 'unstyled', options: ['Blue'] }] })],
      suggested: 'none',
    };
    expect(summaryLines(d)).toEqual(['No variants found on these products']);
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

  it('a links group whose detected axis word is generic defaults its new column to Colour, not the word itself (N3)', () => {
    const optionLinks = { container: 'div.items', count: 2, links: [{ href: 'https://shop.example/p/1-a', label: 'A' }, { href: 'https://shop.example/p/1-b', label: 'B' }] };
    const d: DetectResult = { pages: [page(1, { links: [optionLinks] })], suggested: 'links' };
    // No known word in the container and no matching picker: linksWord falls back to "option".
    expect(axesFor(d, 'links')).toEqual([{ from: 'option', label: 'Colour', options: ['A', 'B'] }]);
  });

  it('a links group named by a picker axis of "variant" or "swatch" also defaults to Colour', () => {
    const swatchLinks = { container: 'div.items', count: 1, links: [{ href: 'https://shop.example/p/1-red', label: 'Red' }] };
    const d: DetectResult = { pages: [page(1, { links: [swatchLinks], pickers: [{ axis: 'swatch', options: ['Red'] }] })], suggested: 'links' };
    expect(axesFor(d, 'links')).toEqual([{ from: 'swatch', label: 'Colour', options: ['Red'] }]);
  });

  it('the list method is unaffected by N3 — a generic word there keeps its own label', () => {
    expect(axisLabel('option2')).toBe('Option 2');
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
    // Some failed, some still coming: still worth waiting.
    expect(variantsStepState({ ...base, detection: null, failedCards: 2 })).toEqual({ kind: 'no-pages', reason: 'Wait for the screenshots' });
  });

  it('every screenshot failed: retry them, not wait', () => {
    expect(variantsStepState({ ...base, detection: null, failedCards: 3 })).toEqual({ kind: 'no-pages', reason: 'The screenshots failed — retry them above' });
    const none = { pages: [1, 2, 3].map((n) => page(n, { captured: false })), suggested: 'none' as const };
    expect(variantsStepState({ ...base, detection: none, failedCards: 3 })).toEqual({ kind: 'no-pages', reason: 'The screenshots failed — retry them above' });
  });

  it('Change reopens the form on the confirmed method, not the fresh suggestion', () => {
    const setup = { method: 'links' as const, axes: [], confirmedAt: '2026-10-01T00:00:00Z' };
    const s = variantsStepState({ ...base, setup, changing: true });
    expect(s).toMatchObject({ kind: 'found', suggested: 'list', initialMethod: 'links', axes: [] });
    expect(variantsStepState({ ...base, setup, changing: true, detection: linksOnAll })).toMatchObject({
      initialMethod: 'links',
      axes: [{ from: 'colour', label: 'Colour' }],
    });
  });

  it('found: summary, suggestion, axes and picker-only words', () => {
    expect(variantsStepState(base)).toEqual({
      kind: 'found',
      summary: ['Listed in the page data: 2 colours on product 1, 2 on product 2, none on product 3'],
      suggested: 'list',
      initialMethod: 'list',
      axes: [{ from: 'color', label: 'Colour', options: ['Red', 'Blue', 'Green'] }],
      pickerOnly: [],
      noColumns: false,
    });
    const p = variantsStepState({ ...base, detection: pickerOnlySizes });
    expect(p).toMatchObject({ kind: 'found', suggested: 'none', axes: [], pickerOnly: ['sizes'], noColumns: false });
  });

  it('found over lists with no detected column carries noColumns', () => {
    const noColumnList = { source: 'json-ld' as const, path: 'hasVariant', count: 6, axes: [], entries: [{ sku: 'S1' }] };
    const d: DetectResult = { pages: [1, 2, 3].map((n) => page(n, { lists: [noColumnList] })), suggested: 'list' };
    expect(variantsStepState({ ...base, detection: d })).toMatchObject({ kind: 'found', noColumns: true });
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

describe('column targets', () => {
  const colour = { from: 'color', label: 'Colour' };
  const axes = [{ key: 'hue', name: 'Hue' }, { key: 'colour', name: 'Colour' }];

  it('an existing column of the same name, else a new one', () => {
    expect(defaultTarget(colour, axes, null)).toBe('colour');
    expect(defaultTarget(colour, [{ key: 'hue', name: 'Hue' }], null)).toBe(NEW_COLUMN);
  });

  it('on Change, the stored mapping while its column still exists', () => {
    const setup = { method: 'list' as const, axes: [{ from: 'color', axisKey: 'hue' }], confirmedAt: '2026-10-01T00:00:00Z' };
    expect(defaultTarget(colour, axes, setup)).toBe('hue');
    expect(defaultTarget(colour, [{ key: 'colour', name: 'Colour' }], setup)).toBe('colour'); // "hue" is gone: by name
    expect(defaultTarget(colour, [], setup)).toBe(NEW_COLUMN);
  });

  it('a new column whose name a field or column already has is called "<Name> (variant)"', () => {
    expect(newColumnName('Colour', ['Price', 'Size'])).toBe('Colour');
    expect(newColumnName('Colour', ['Price', ' colour '])).toBe('Colour (variant)');
  });

  it('two axes that become the same new column send the same name, so it is made once', () => {
    const found = [{ from: 'color', label: 'Colour' }, { from: 'colour', label: 'Colour' }, { from: 'size', label: 'Size' }];
    const target = (a: { from: string }) => (a.from === 'size' ? 'size_key' : NEW_COLUMN);
    expect(axisMappings(found, target, ['Colour'])).toEqual([
      { from: 'color', newAxisName: 'Colour (variant)' },
      { from: 'colour', newAxisName: 'Colour (variant)' },
      { from: 'size', axisKey: 'size_key' },
    ]);
  });
});
