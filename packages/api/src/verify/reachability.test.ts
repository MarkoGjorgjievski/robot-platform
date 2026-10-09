import { describe, expect, it } from 'vitest';
import { reachabilityResult } from './reachability.js';

describe('reachabilityResult', () => {
  it('an ok capture reads "Reached host (HTTP 200)."', () => {
    expect(reachabilityResult('https://www.ulta.com/shop/x', { kind: 'ok', status: 200 }, 'https://www.ulta.com/shop/x', 812))
      .toEqual({ verdict: { kind: 'ok', status: 200 }, message: 'Reached ulta.com (HTTP 200).', finalUrl: 'https://www.ulta.com/shop/x', ms: 812 });
  });
  it('a CaptureError kind reads its sentence with no final url', () => {
    expect(reachabilityResult('https://scan.co.uk/x', { kind: 'timeout' }, null, 30_000).message).toBe('scan.co.uk did not answer in time.');
  });
  it('a host still backing off says how long we wait', () => {
    const r = reachabilityResult('https://www.ulta.com/shop/x', { kind: 'challenge', status: 0 }, null, 0, 90_000);
    expect(r.message.endsWith('Waiting 2 min before trying again.')).toBe(true);
    expect(r.message.startsWith('ulta.com asked for a human check (CAPTCHA).')).toBe(true);
    expect(r.waitMs).toBe(90_000);
  });
});
