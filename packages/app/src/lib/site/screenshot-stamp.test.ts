import { describe, expect, it } from 'vitest';
import { bandFor, cutToFit, stampText, stampedFilename } from './screenshot-stamp';
import { zoneOffset } from '../when';

const at = new Date(2026, 10, 13, 20, 5);

describe('the screenshot stamp', () => {
  it('says when, with the offset from UTC', () => {
    expect(stampText(at, 60)).toBe('Screenshot taken 13 Nov 2026, 20:05 UTC+1');
    expect(stampText(at.toISOString(), 0)).toBe('Screenshot taken 13 Nov 2026, 20:05 UTC');
    expect(stampText(null)).toBeNull();
  });
  it('names the offset', () => {
    expect(zoneOffset(at, -330)).toBe('UTC-5:30');
    expect(zoneOffset(at, 120)).toBe('UTC+2');
  });
  it('names the file by product and time', () => {
    expect(stampedFilename(2, at)).toBe('screenshot-product-2-2026-11-13-2005.png');
  });
  it('the band scales with the picture', () => {
    expect(bandFor(1280)).toEqual({ height: 72, font: 20, pad: 20 });
    expect(bandFor(2560).height).toBe(144);
  });
  it('cuts a long address to fit', () => {
    expect(cutToFit('abcdef', (t) => t.length <= 10)).toBe('abcdef');
    expect(cutToFit('abcdefghijkl', (t) => t.length <= 5)).toBe('abcd…');
  });
});
