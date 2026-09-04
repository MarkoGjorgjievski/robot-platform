import { describe, it, expect } from 'vitest';
import { applyTransform, inferTransform } from './transforms.js';

describe('applyTransform', () => {
  it('identity returns raw', () => expect(applyTransform('x', 'identity')).toBe('x'));
  it('cents_to_units divides numbers by 100', () => expect(applyTransform(12999, 'cents_to_units')).toBe(129.99));
  it('cents_to_units leaves non-numbers alone', () => expect(applyTransform('abc', 'cents_to_units')).toBe('abc'));
  it('first_of_list takes the first array item', () => expect(applyTransform(['a', 'b'], 'first_of_list')).toBe('a'));
  it('first_of_list on a non-array returns raw', () => expect(applyTransform('a', 'first_of_list')).toBe('a'));
});

describe('inferTransform', () => {
  it('prefers identity', () => expect(inferTransform('money', '$129.99', '129.99')).toBe('identity'));
  it('finds cents for money', () => expect(inferTransform('money', 12999, '129.99')).toBe('cents_to_units'));
  it('never uses cents for text', () => expect(inferTransform('text', 12999, '129.99')).toBeNull());
  it('finds first_of_list for a url array', () => {
    expect(inferTransform('image', ['https://c.example/a.jpg', 'https://c.example/b.jpg'], 'https://c.example/a.jpg')).toBe('first_of_list');
  });
  it('returns null when nothing matches', () => expect(inferTransform('number', '5', '6')).toBeNull());
});
