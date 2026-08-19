import { describe, it, expect } from 'vitest';
import { FIELD_ORIGINS, originLabel } from './field-origin';

describe('field origin', () => {
  it('offers exactly the four origins the pipeline understands', () => {
    expect(FIELD_ORIGINS).toEqual(['detail', 'listing', 'input', 'system']);
  });

  it('labels an unset origin as the detail default rather than blank', () => {
    expect(originLabel(undefined)).toBe('Detail page');
  });

  it('labels each origin in the language of where the value comes from', () => {
    expect(originLabel('listing')).toBe('Listing page');
    expect(originLabel('input')).toBe('Input column');
    expect(originLabel('system')).toBe('System');
  });
});
