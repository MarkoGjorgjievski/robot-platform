import { describe, it, expect } from 'vitest';
import { checkPageHealth } from './page-health.js';

/** A real product page that happens to load a CAPTCHA widget for its login form.
 *  Measured on 2026-08-18: Newegg (45,807 chars of visible text) and Target
 *  (8,111) both contain "captcha" in their HTML and were only judged healthy
 *  because the string happens to fall after byte 5000. */
const realPageWithCaptchaScript = (bodyText: string) => `
<html>
  <head>
    <title>SAMSUNG SSD 9100 PRO 2TB — Newegg.com</title>
    <script src="https://www.google.com/recaptcha/api.js" async defer></script>
  </head>
  <body><main><h1>SAMSUNG SSD 9100 PRO 2TB</h1><p>${bodyText}</p></main></body>
</html>`;

/** Wayfair's actual interstitial, 2026-08-18: 168 chars of visible text. */
const WAYFAIR_BLOCK = `
<html>
  <head><title>Access to this page has been denied</title></head>
  <body>
    <div>Please verify you are a human. Complete the captcha below to continue.</div>
  </body>
</html>`;

/** Etsy's actual interstitial, 2026-08-18: 8 chars of visible text. */
const ETSY_BLOCK = `
<html><head><title>etsy.com</title><script src="/captcha.js"></script></head>
<body>Loading</body></html>`;

describe('checkPageHealth — bot detection', () => {
  it('does NOT block a content-rich page that merely loads a CAPTCHA script', () => {
    // The exact latent false positive: a real page whose <head> references
    // recaptcha. Before the fix this was only healthy by accident of byte offset.
    const html = realPageWithCaptchaScript('Solid state drive. '.repeat(200));
    const r = checkPageHealth(html, 'SAMSUNG SSD 9100 PRO 2TB — Newegg.com', 'https://www.newegg.com/p/x');
    expect(r.healthy).toBe(true);
  });

  it('blocks a challenge interstitial with a denial title', () => {
    const r = checkPageHealth(WAYFAIR_BLOCK, 'Access to this page has been denied', 'https://www.wayfair.com/x');
    expect(r.healthy).toBe(false);
  });

  it('blocks a content-free captcha interstitial', () => {
    const r = checkPageHealth(ETSY_BLOCK, 'etsy.com', 'https://www.etsy.com/x');
    expect(r.healthy).toBe(false);
  });

  it('still blocks a page whose TITLE is the captcha challenge, however much markup it carries', () => {
    const html = `<html><head><title>Captcha</title></head><body>${'<div>x</div>'.repeat(500)}</body></html>`;
    const r = checkPageHealth(html, 'Captcha', 'https://example.com/x');
    expect(r.healthy).toBe(false);
  });

  it('still blocks Cloudflare challenge pages', () => {
    const html = '<html><body>Checking your browser before accessing. Ray ID: 12ab. cloudflare</body></html>';
    expect(checkPageHealth(html, 'Just a moment...', 'https://example.com').healthy).toBe(false);
  });
});

describe('checkPageHealth — pre-existing behaviour must not regress', () => {
  it('blocks HTTP error pages', () => {
    expect(checkPageHealth('<html><body>403 Forbidden</body></html>', '403 Forbidden', 'https://x.com').healthy).toBe(false);
  });

  it('blocks soft 404s', () => {
    expect(checkPageHealth('<html><body>nothing here at all</body></html>', 'Page Not Found', 'https://x.com').healthy).toBe(false);
  });

  it('blocks near-empty pages', () => {
    expect(checkPageHealth('<html><body>hi</body></html>', 'Fine', 'https://x.com').healthy).toBe(false);
  });

  it('accepts an ordinary content page', () => {
    const html = `<html><body><main>${'Real product copy. '.repeat(100)}</main></body></html>`;
    expect(checkPageHealth(html, 'A Product', 'https://x.com').healthy).toBe(true);
  });
  it("accepts a real product page whose title mentions human verification", () => {
    const html = `<html><head><title>Human Verification Kit</title></head><body><main>${"Real product copy. ".repeat(100)}</main></body></html>`;
    expect(checkPageHealth(html, "Human Verification Kit", "https://x.com").healthy).toBe(true);
  });

  it("still flags an AWS WAF human check", () => {
    const html = "<html><head><title>Human Verification</title></head><body><p>Let's confirm you are human. Complete the security check.</p></body></html>";
    expect(checkPageHealth(html, "Human Verification", "https://x.com").healthy).toBe(false);
  });
});
