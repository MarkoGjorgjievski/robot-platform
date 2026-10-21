import { describe, expect, it } from 'vitest';
// Test only: the real sentences, so a change to verdict-copy.ts the mapper no longer
// recognises fails here instead of leaking a host (spec 2026-10-21 §6). The shipped app
// imports nothing from @robot/browser.
import { verdictSentence } from '../../../browser/src/verdict-copy';
import { BLOCKED_SENTENCE, PAGE_NOT_READ_SENTENCE, captureWords } from './capture-words';

const HOSTS = ['https://www.shop.example/p/1', 'https://scan.co.uk/c/gpu', 'http://localhost:4321/blocked', 'not a url'];
const VENDORS = ['cloudflare', 'akamai', 'perimeterx', 'datadome', 'aws-waf', 'unknown', undefined] as const;

type V = Parameters<typeof verdictSentence>[0];
const CASES: Array<[V, string]> = [
  [{ kind: 'ok', status: 200 } as V, 'This website opens normally.'],
  ...VENDORS.map((vendor): [V, string] => [{ kind: 'refused', status: 403, ...(vendor ? { vendor } : {}) } as V, "This website turned us away, so we can't read it yet."]),
  [{ kind: 'challenge', status: 403 } as V, 'This website asked for a human check. Wait a few minutes and try again; its other pages are behind the same check.'],
  [{ kind: 'not-found', status: 404 } as V, "That page doesn't exist. Check the address."],
  [{ kind: 'redirected', status: 200, to: 'https://other.example/home' } as V, 'That address opened a page on another website. Paste a page from this website.'],
  [{ kind: 'blank', status: 200 } as V, 'The page came back empty. Try again.'],
  [{ kind: 'wrong-variant', status: 200, named: 'color=red' } as V, 'The page did not show the variant its address names. Check the address, or use another product.'],
  [{ kind: 'crashed' } as V, 'The page stopped loading before we could read it. Try again.'],
  [{ kind: 'unreachable' } as V, 'This website did not respond. Check the address, or try again later.'],
  [{ kind: 'timeout' } as V, 'This website took too long to answer. Try again.'],
];

const LEAKS = [/shop\.example|scan\.co\.uk|localhost|other\.example|not a url/i, /https?:/i, /\bHTTP\b/, /\b\d{3}\b/, /Cloudflare|Akamai|PerimeterX|DataDome|AWS WAF/i, /CAPTCHA/i, /\bbrowser\b/i, /color=red/];

describe('captureWords (spec 2026-10-21 §3)', () => {
  for (const url of HOSTS) {
    for (const [v, want] of CASES) {
      const stored = verdictSentence(v, url);
      it(`${v.kind}${'vendor' in v && v.vendor ? ` (${v.vendor})` : ''} on ${url}`, () => {
        expect(captureWords(stored)).toBe(want);
        expect(captureWords(`Not tried: ${stored}`)).toBe(`Not tried: ${want}`);
        expect(captureWords(`${stored} Waiting 2 min before trying again.`)).toBe(`${want} Waiting 2 min before trying again.`);
        for (const leak of LEAKS) expect(captureWords(stored)).not.toMatch(leak);
        expect(captureWords(stored, true)).toBe(stored);
      });
    }
  }

  it('a same-site redirect reads as a different page, never the address', () => {
    expect(captureWords('redirected to https://www.shop.example/c/shoes')).toBe('That address opened a different page. Check the link, or use another product.');
  });

  it('our own sentences pass through', () => {
    for (const s of ["We couldn't open a browser to read this page. Try again in a minute.", 'stalled', 'No value found for Price.', 'Verify stopped before it finished. Try again.']) {
      expect(captureWords(s)).toBe(s);
    }
  });

  it('anything else holding a host, an address, a status or library text becomes the generic sentence', () => {
    for (const s of ['page.goto: net::ERR_NAME_NOT_RESOLVED at https://x.example', 'listing capture failed: HTTP 404 Not Found', 'Page blocked or unusable: CAPTCHA detected', 'fetch failed for shop.example']) {
      expect(captureWords(s)).toBe(PAGE_NOT_READ_SENTENCE);
    }
    expect(captureWords('Page blocked or unusable: CAPTCHA detected', false, BLOCKED_SENTENCE)).toBe(BLOCKED_SENTENCE);
  });
});
