import { describe, it, expect } from 'vitest';
import { isThirdPartyNoise } from './intercept-noise.js';

describe('isThirdPartyNoise', () => {
  it('rejects OneTrust consent template assets (cookielaw.org)', () => {
    expect(isThirdPartyNoise(
      'https://cdn.cookielaw.org/scripttemplates/202508.2.0/assets/otFlat.json'
    )).toBe(true);
    expect(isThirdPartyNoise(
      'https://cdn.cookielaw.org/scripttemplates/202508.2.0/assets/v2/otPcPanel.json'
    )).toBe(true);
  });

  it('rejects first-party hosted optimizely A/B-test asset blobs', () => {
    expect(isThirdPartyNoise(
      'https://www.ikea.com/global/assets/optimizely/B55RSZvdcuDQ8kD1YxvvN.json'
    )).toBe(true);
  });

  it('rejects OneTrust filenames even when re-hosted on a first-party CDN', () => {
    expect(isThirdPartyNoise('https://cdn.example.com/assets/otFlat.json')).toBe(true);
    expect(isThirdPartyNoise('https://shop.example.com/static/otPcPanel.JSON')).toBe(true);
  });

  it('rejects common analytics, A/B-test, and session-replay hosts', () => {
    expect(isThirdPartyNoise('https://www.google-analytics.com/g/collect')).toBe(true);
    expect(isThirdPartyNoise('https://api.hotjar.com/v1/x')).toBe(true);
    expect(isThirdPartyNoise('https://logx.optimizely.com/v1/events')).toBe(true);
    expect(isThirdPartyNoise('https://api.amplitude.com/2/httpapi')).toBe(true);
  });

  it('does NOT reject real first-party product / cart APIs', () => {
    expect(isThirdPartyNoise(
      'https://prod.cart.caas.selling.ingka.com/api/v1/us?fetchItemInfo=true'
    )).toBe(false);
    expect(isThirdPartyNoise(
      'https://api.salesitem.ingka.com/availabilities/ru/us?itemNos=80275887'
    )).toBe(false);
    expect(isThirdPartyNoise(
      'https://www.newegg.com/api/PageConfigRecommendation?page_type=Product'
    )).toBe(false);
    expect(isThirdPartyNoise(
      'https://api.nike.com/products/experience/v1/abc/US/en/styleCode/850000'
    )).toBe(false);
  });

  it('does NOT reject review platforms (turnto) — they carry real review data', () => {
    expect(isThirdPartyNoise(
      'https://cdn-ws.turnto.com/v5/sitedata/x/850000/d/review/en_US/0/10/'
    )).toBe(false);
  });

  it('returns false for malformed URLs', () => {
    expect(isThirdPartyNoise('not a url')).toBe(false);
    expect(isThirdPartyNoise('')).toBe(false);
  });
});
