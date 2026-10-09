import { describe, expect, it } from 'vitest';
import { classifyVerdict, classifyNavigationError } from './verdict.js';

const PRODUCT = `<html><head><title>Widget A</title></head><body><h1>Widget A</h1>${'<p>Real product copy that goes on. </p>'.repeat(60)}<script>var captcha = false;</script></body></html>`;
const CF_CHALLENGE = '<html><head><title>Just a moment...</title></head><body><div>Checking your browser before accessing shop.example. Ray ID: abc</div></body></html>';
const AWS_WAF = '<html><head><title>Human Verification</title></head><body><p>Let\'s confirm you are human. Complete the security check.</p></body></html>';
const AKAMAI = '<html><head><title>Access Denied</title></head><body><h1>Access Denied</h1><p>You don\'t have permission to access this page. Reference #18.5f3</p></body></html>';
const base = { requestedUrl: 'https://shop.example/l', finalUrl: 'https://shop.example/l', headers: {} as Record<string, string> };

describe('classifyVerdict', () => {
  it('a healthy 200 page is ok, even when its scripts mention captcha', () => {
    expect(classifyVerdict({ ...base, status: 200, html: PRODUCT, title: 'Widget A' })).toEqual({ kind: 'ok', status: 200 });
  });
  it('a Cloudflare challenge served with 200 is a challenge, vendor cloudflare', () => {
    expect(classifyVerdict({ ...base, status: 200, html: CF_CHALLENGE, title: 'Just a moment...' })).toEqual({ kind: 'challenge', status: 200, vendor: 'cloudflare' });
  });
  it('a 403 with a Cloudflare body is refused, vendor cloudflare', () => {
    expect(classifyVerdict({ ...base, status: 403, headers: { server: 'cloudflare', 'cf-ray': 'x' }, html: CF_CHALLENGE, title: 'Just a moment...' })).toEqual({ kind: 'refused', status: 403, vendor: 'cloudflare' });
  });
  it('an AWS WAF human check is a challenge, vendor aws-waf', () => {
    expect(classifyVerdict({ ...base, status: 405, headers: { 'x-amzn-waf-action': 'challenge' }, html: AWS_WAF, title: 'Human Verification' })).toEqual({ kind: 'challenge', status: 405, vendor: 'aws-waf' });
  });
  it('an Akamai Access Denied is refused, vendor akamai', () => {
    expect(classifyVerdict({ ...base, status: 403, headers: { server: 'AkamaiGHost' }, html: AKAMAI, title: 'Access Denied' })).toEqual({ kind: 'refused', status: 403, vendor: 'akamai' });
  });
  it('a 429 with no wall body is refused with no vendor', () => {
    expect(classifyVerdict({ ...base, status: 429, html: '<html><body>Too many requests</body></html>', title: '' })).toEqual({ kind: 'refused', status: 429 });
  });
  it('a 404 is not-found; so is a soft 404 by title', () => {
    expect(classifyVerdict({ ...base, status: 404, html: PRODUCT, title: 'Widget A' })).toEqual({ kind: 'not-found', status: 404 });
    expect(classifyVerdict({ ...base, status: 200, html: '<html><body>Try searching or go to the home page.</body></html>', title: 'Page not found' })).toEqual({ kind: 'not-found', status: 200 });
  });
  it('a redirect to another host is redirected; within the host it is ok', () => {
    expect(classifyVerdict({ ...base, finalUrl: 'https://login.other.example/x', status: 200, html: PRODUCT, title: 'Widget A' })).toEqual({ kind: 'redirected', status: 200, to: 'login.other.example' });
    expect(classifyVerdict({ ...base, finalUrl: 'https://shop.example/l2?x=1', status: 200, html: PRODUCT, title: 'Widget A' })).toEqual({ kind: 'ok', status: 200 });
  });
  it('a 200 with almost no visible text and no boxes is blank', () => {
    expect(classifyVerdict({ ...base, status: 200, html: '<html><head><script>app()</script></head><body><div id="app"></div></body></html>', title: '', boxCount: 0 })).toEqual({ kind: 'blank', status: 200 });
  });
  it('a thin SPA shell with _px in its markup is blank, not a PerimeterX wall', () => {
    expect(classifyVerdict({ ...base, status: 200, html: '<html><head><script>var a_px=1</script></head><body><div id="app"></div></body></html>', title: '', boxCount: 0 })).toEqual({ kind: 'blank', status: 200 });
  });
  it('no status (a replay) with a healthy page is ok with status 0', () => {
    expect(classifyVerdict({ ...base, status: null, html: PRODUCT, title: 'Widget A' })).toEqual({ kind: 'ok', status: 0 });
  });
});

describe('classifyNavigationError', () => {
  it('names a crash, a dead host and a timeout', () => {
    expect(classifyNavigationError(new Error('page.goto: Target crashed'))).toBe('crashed');
    expect(classifyNavigationError(new Error('Page crashed'))).toBe('crashed');
    expect(classifyNavigationError(new Error('page.goto: net::ERR_NAME_NOT_RESOLVED at https://x'))).toBe('unreachable');
    expect(classifyNavigationError(new Error('page.goto: net::ERR_CONNECTION_REFUSED'))).toBe('unreachable');
    expect(classifyNavigationError(new Error('page.goto: Timeout 60000ms exceeded.'))).toBe('timeout');
    expect(classifyNavigationError(new Error('something else'))).toBe('unreachable');
  });
});

// Review I1/I5/I6/M1/M6, 2026-10-09: pages measured to read as false walls.
const thinText = '<p>Linen apron, natural. Washed linen, adjustable neck strap, two front pockets. Machine washable at 40 degrees. Ships in two days.</p><p>£24.00</p><button>Add to basket</button>';
describe('classifyVerdict — thin legitimate pages are not walls', () => {
  it('a thin product page carrying a cdnjs.cloudflare.com script (12 boxes, Cloudflare headers) is ok', () => {
    const html = `<html><head><title>Linen apron</title><script src="https://cdnjs.cloudflare.com/ajax/libs/lodash.js/4.17.21/lodash.min.js"></script></head><body><h1>Linen apron</h1>${thinText}</body></html>`;
    expect(classifyVerdict({ ...base, status: 200, headers: { server: 'cloudflare', 'cf-ray': '8a1' }, html, title: 'Linen apron', boxCount: 12 })).toEqual({ kind: 'ok', status: 200 });
  });
  it('a thin Cloudflare 404 is not-found, not refused', () => {
    const html = '<html><head><title>404 Not Found</title></head><body><h1>404 Not Found</h1><hr><center>cloudflare</center></body></html>';
    expect(classifyVerdict({ ...base, status: 404, headers: { server: 'cloudflare', 'cf-ray': '8a1' }, html, title: '404 Not Found' })).toEqual({ kind: 'not-found', status: 404 });
  });
  it('a thin page with a reCAPTCHA review form (8 boxes) is ok', () => {
    const html = `<html><head><title>Linen apron</title><script src="https://www.google.com/recaptcha/api.js" async defer></script></head><body><h1>Linen apron</h1>${thinText}<form><textarea name="review"></textarea><div class="g-recaptcha" data-sitekey="x"></div><button>Post review</button></form></body></html>`;
    expect(classifyVerdict({ ...base, status: 200, html, title: 'Linen apron', boxCount: 8 })).toEqual({ kind: 'ok', status: 200 });
  });
  it('a 200 whose only vendor sign is a header is not refused, but a 403 names its vendor', () => {
    const html = `<html><head><title>Linen apron</title></head><body><h1>Linen apron</h1>${thinText}</body></html>`;
    expect(classifyVerdict({ ...base, status: 200, headers: { 'cf-ray': '8a1' }, html, title: 'Linen apron' }).kind).toBe('ok');
    expect(classifyVerdict({ ...base, status: 403, headers: { 'cf-ray': '8a1' }, html, title: 'Linen apron' })).toEqual({ kind: 'refused', status: 403, vendor: 'cloudflare' });
  });
  it('a PerimeterX press-and-hold marker on a thin 200 is still a challenge', () => {
    const html = '<html><head><title>shop.example</title></head><body><div id="px-captcha"></div></body></html>';
    expect(classifyVerdict({ ...base, status: 200, html, title: 'shop.example' })).toEqual({ kind: 'challenge', status: 200, vendor: 'perimeterx' });
  });
  it('a challenge whose words are only in a script is not a wall', () => {
    const html = `<html><head><title>Linen apron</title><script>var msg = "verify you are human";</script></head><body><h1>Linen apron</h1>${thinText}</body></html>`;
    expect(classifyVerdict({ ...base, status: 200, html, title: 'Linen apron', boxCount: 12 }).kind).toBe('ok');
  });
});

describe('classifyVerdict — redirects, other 4xx, titles', () => {
  it('a redirect within the registrable domain is ok; to another domain it is redirected', () => {
    expect(classifyVerdict({ ...base, requestedUrl: 'https://www.hm.com/p/1', finalUrl: 'https://www2.hm.com/en_gb/p/1', status: 200, html: PRODUCT, title: 'Widget A' }).kind).toBe('ok');
    expect(classifyVerdict({ ...base, requestedUrl: 'https://x.com/p/1', finalUrl: 'https://uk.x.com/p/1', status: 200, html: PRODUCT, title: 'Widget A' }).kind).toBe('ok');
    expect(classifyVerdict({ ...base, requestedUrl: 'https://shop.example.co.uk/p', finalUrl: 'https://example.co.uk/p', status: 200, html: PRODUCT, title: 'Widget A' }).kind).toBe('ok');
    expect(classifyVerdict({ ...base, requestedUrl: 'https://x.com/p/1', finalUrl: 'https://login.other.com/sso', status: 200, html: PRODUCT, title: 'Widget A' })).toEqual({ kind: 'redirected', status: 200, to: 'login.other.com' });
  });
  it('HTTP 400 and other unlisted 4xx are refused, not blank', () => {
    expect(classifyVerdict({ ...base, status: 400, html: '<html><body></body></html>', title: '' })).toEqual({ kind: 'refused', status: 400 });
    expect(classifyVerdict({ ...base, status: 418, html: PRODUCT, title: 'Widget A' })).toEqual({ kind: 'refused', status: 418 });
    expect(classifyVerdict({ ...base, status: 410, html: PRODUCT, title: 'Widget A' })).toEqual({ kind: 'not-found', status: 410 });
  });
  it('a full page titled "Access Denied" reads refused, not a human check', () => {
    const html = `<html><head><title>Access Denied</title></head><body>${'<p>The film Access Denied follows a hacker through a long night. </p>'.repeat(30)}</body></html>`;
    expect(classifyVerdict({ ...base, status: 200, html, title: 'Access Denied' })).toEqual({ kind: 'refused', status: 200, vendor: 'unknown' });
  });
  it('a product titled "Levi\'s 404 Jeans" is ok; a title "404 - Page Not Found" is not-found', () => {
    expect(classifyVerdict({ ...base, status: 200, html: PRODUCT, title: "Levi's 404 Jeans" })).toEqual({ kind: 'ok', status: 200 });
    expect(classifyVerdict({ ...base, status: 200, html: PRODUCT, title: '404 - Page Not Found' }).kind).toBe('not-found');
    expect(classifyVerdict({ ...base, status: 200, html: PRODUCT, title: 'Error 404' }).kind).toBe('not-found');
  });
  it('inline CSS does not count as visible text for the blank rule', () => {
    const html = `<html><head><style>${'.a{color:red}'.repeat(200)}</style></head><body><div id="app">Loading the shop, one moment please while everything is fetched for you right now.</div></body></html>`;
    expect(classifyVerdict({ ...base, status: 200, html, title: 'Shop', boxCount: 0 }).kind).toBe('blank');
  });
});
