import { describe, it, expect } from 'vitest';
import type { CaptureVerdict } from '@robot/browser';
import { captureProblem, CaptureProblemError } from './capture-check.js';

const ok = { url: 'https://shop.example/p/1?utm=x', html: '<html><body><h1>Widget</h1><p>' + 'a lovely product '.repeat(80) + '</p></body></html>', title: 'Widget', verdict: { kind: 'ok', status: 200 } as CaptureVerdict };

describe('captureProblem', () => {
  it('is null for the requested page (query and trailing slash ignored)', () => {
    expect(captureProblem(ok, 'https://shop.example/p/1/')).toBeNull();
  });
  it('names a redirect to another path', () => {
    expect(captureProblem({ ...ok, url: 'https://shop.example/category' }, 'https://shop.example/p/1')?.reason).toBe('redirected to https://shop.example/category');
  });
  it('names an unusable page', () => {
    const blocked = { ...ok, html: '<html><body>Access denied</body></html>', title: 'Access Denied', verdict: { kind: 'refused', status: 403 } as CaptureVerdict };
    expect(captureProblem(blocked, 'https://shop.example/p/1')?.reason).toMatch(/./);
  });
});

const cap = (verdict: CaptureVerdict, url = 'https://shop.example/p/1') =>
  ({ url, html: '<html><body>' + 'x '.repeat(1000) + '</body></html>', title: 'P', verdict });

describe('captureProblem reads the verdict', () => {
  it('ok on the same path is no problem', () => {
    expect(captureProblem(cap({ kind: 'ok', status: 200 }), 'https://shop.example/p/1')).toBeNull();
  });
  it('a refused capture is the verdict sentence, with the verdict attached', () => {
    const p = captureProblem(cap({ kind: 'refused', status: 403, vendor: 'cloudflare' }), 'https://shop.example/p/1');
    expect(p?.reason).toBe("shop.example refused the browser (HTTP 403, Cloudflare). We can't read this website from here yet.");
    expect(p?.verdict?.kind).toBe('refused');
  });
  it('a same-host different-path landing is still "redirected to" (proof pages must be the page asked for)', () => {
    const p = captureProblem(cap({ kind: 'ok', status: 200 }, 'https://shop.example/collections/all'), 'https://shop.example/p/1');
    expect(p?.reason).toBe('redirected to https://shop.example/collections/all');
    expect(p?.verdict).toBeUndefined();
  });
  it('CaptureProblemError carries the verdict', () => {
    const e = new CaptureProblemError('x', { kind: 'blank', status: 200 });
    expect(e.verdict?.kind).toBe('blank');
  });
});
