import { describe, it, expect } from 'vitest';
import { suggestMarks } from './suggest-marks.js';
import { loadVerifyFixture } from '../__fixtures__/verify/load.js';
import type { Box } from './box-map.js';
import type { SchemaDefinitionField } from './types.js';

const f = (key: string, type: SchemaDefinitionField['type'], concept: string): SchemaDefinitionField => ({ key, name: key, type, description: '', concept });
const box = (text: string, i: number, extra: Partial<Box> = {}): Box => ({ xpaths: [`//b[${i}]`], text, rect: { x: 0, y: i * 10, w: 10, h: 10 }, tag: 'span', kind: 'text', ...extra });
const p1 = loadVerifyFixture('shop-example', 'p1');
const boxes: Box[] = [box('Widget A', 0), box('$129.99', 1), box('$159.99', 2), box('In stock', 3), box('', 4, { kind: 'image', tag: 'img', src: 'https://shop.example/img/a.jpg' }), box('$129.99', 5)];

describe('suggestMarks', () => {
  it('price: JSON-LD offers.price, shown in two places → both boxes', () => {
    const r = suggestMarks(p1, boxes, [f('price', 'money', 'price')]);
    expect(r.price).toEqual({ value: '129.99', via: { source: 'json-ld', path: 'offers.price' }, boxes: [1, 5] });
  });
  it('title: JSON-LD name, one box', () => {
    expect(suggestMarks(p1, boxes, [f('title', 'text', 'product_name')]).title).toEqual({ value: 'Widget A', via: { source: 'json-ld', path: 'name' }, boxes: [0] });
  });
  it('image: matched against src', () => {
    expect(suggestMarks(p1, boxes, [f('image', 'image', 'image_url')]).image).toMatchObject({ value: 'https://shop.example/img/a.jpg', boxes: [4] });
  });
  it('sku: only in the API body → value with no boxes ("page data")', () => {
    expect(suggestMarks(p1, boxes, [f('sku', 'text', 'sku')]).sku).toEqual({ value: 'SKU-A1', via: { source: 'api', path: 'item.code' }, boxes: [] });
  });
  it('a value the field type rejects is skipped; nothing found → null', () => {
    expect(suggestMarks(p1, boxes, [f('weight', 'number', 'weight')]).weight).toBeNull();
  });
  it('an API integer-cents price is not offered as the price when JSON-LD has one', () => {
    expect(suggestMarks(p1, boxes, [f('price', 'money', 'price')]).price!.value).toBe('129.99');
  });
  it('a field with an unknown concept falls back to its key as a path tail', () => {
    expect(suggestMarks(p1, boxes, [f('colors', 'text_list', 'colors')]).colors).toMatchObject({ via: { source: 'api', path: 'item.colors' } });
  });
});
