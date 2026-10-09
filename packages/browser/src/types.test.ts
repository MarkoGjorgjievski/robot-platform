import { describe, expect, it } from 'vitest';
import { CaptureError } from './types.js';

describe('CaptureError', () => {
  it('carries the verdict sentence as its message and Playwright\'s text as detail', () => {
    const e = new CaptureError('timeout', 'https://www.shop.example/p/1', 'page.goto: Timeout 60000ms exceeded.\nCall log: ...');
    expect(e.message).toBe('shop.example did not answer in time.');
    expect(e.detail).toContain('Timeout 60000ms exceeded');
    expect(e.kind).toBe('timeout');
  });
});
