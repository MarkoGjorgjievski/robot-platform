import { describe, it, expect } from 'vitest';
import { fieldFill, overallFill, thinnestFields } from './run-overview-view';

const cols = [{ key: 'title', name: 'Title' }, { key: 'price', name: 'Price' }, { key: 'discount', name: 'Discount' }];
const rows = [
  { title: 'A', price: '1', discount: '' },
  { title: 'B', price: null, discount: undefined },
  { title: 'C', price: '3', discount: '10%' },
  { title: 'D', price: '4' },
];

describe('run overview', () => {
  it('counts the rows that have a value, per field', () => {
    expect(fieldFill(rows, cols).map((f) => [f.name, f.filled, f.total])).toEqual([['Title', 4, 4], ['Price', 3, 4], ['Discount', 1, 4]]);
  });
  it('the overall share rounds down, and is nothing with no rows', () => {
    expect(overallFill(fieldFill(rows, cols))).toBe(66);
    expect(overallFill(fieldFill([], cols))).toBeNull();
  });
  it('lists the emptiest fields first and leaves full ones out', () => {
    expect(thinnestFields(fieldFill(rows, cols)).map((f) => f.name)).toEqual(['Discount', 'Price']);
  });
});
