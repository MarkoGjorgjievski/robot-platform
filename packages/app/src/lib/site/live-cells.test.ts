import { describe, expect, it } from 'vitest';
import { liveCell } from './live-cells';

describe('liveCell', () => {
  it('says nothing when no Verify runs', () => {
    expect(liveCell(null, 'title', 0)).toBe('still');
  });

  it('waits everywhere while the run starts', () => {
    expect(liveCell('starting', 'title', 2)).toBe('wait');
  });

  it('scans the product whose screenshot is being taken; earlier ones are done, later ones wait', () => {
    expect(liveCell('capturing 2/3', 'title', 0)).toBe('still');
    expect(liveCell('capturing 2/3', 'title', 1)).toBe('scan');
    expect(liveCell('capturing 2/3', 'title', 2)).toBe('wait');
  });

  it('scans every cell while the values are looked for', () => {
    expect(liveCell('searching', 'price', 1)).toBe('scan');
  });

  it('scans only the field that gets a closer look', () => {
    expect(liveCell('asking AI for price', 'price', 0)).toBe('scan');
    expect(liveCell('asking AI for price', 'title', 0)).toBe('still');
  });

  it('leaves the fields alone for a stage that is not about them', () => {
    expect(liveCell('checking variants', 'title', 0)).toBe('still');
    expect(liveCell('something new', 'title', 0)).toBe('still');
  });
});
