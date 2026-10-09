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
});
