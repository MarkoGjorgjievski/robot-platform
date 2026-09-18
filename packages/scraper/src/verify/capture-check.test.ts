import { describe, it, expect } from 'vitest';
import { captureProblem } from './capture-check.js';

const ok = { url: 'https://shop.example/p/1?utm=x', html: '<html><body><h1>Widget</h1><p>' + 'a lovely product '.repeat(80) + '</p></body></html>', title: 'Widget' };

describe('captureProblem', () => {
  it('is null for the requested page (query and trailing slash ignored)', () => {
    expect(captureProblem(ok, 'https://shop.example/p/1/')).toBeNull();
  });
  it('names a redirect to another path', () => {
    expect(captureProblem({ ...ok, url: 'https://shop.example/category' }, 'https://shop.example/p/1')).toBe('redirected to https://shop.example/category');
  });
  it('names an unusable page', () => {
    const blocked = { ...ok, html: '<html><body>Access denied</body></html>', title: 'Access Denied' };
    expect(captureProblem(blocked, 'https://shop.example/p/1')).toMatch(/./);
  });
});
