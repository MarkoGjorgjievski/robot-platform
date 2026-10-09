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
