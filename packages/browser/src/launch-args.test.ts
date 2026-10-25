// Chromium's launch flags (Task 2 review, issue 3): a proxied browser keeps WebRTC's UDP off the direct path, so a page
// cannot learn the worker's own address past the proxy; a browser with no proxy launches exactly as before.
import { describe, it, expect } from 'vitest';
import { launchArgs, WEBRTC_PROXY_ONLY } from './playwright-browser.js';
import { browserOwnerArgs } from './launch-guard.js';

describe('launchArgs', () => {
  it('with a proxy: the WebRTC policy that sends no UDP outside the proxy', () => {
    expect(WEBRTC_PROXY_ONLY).toBe('--force-webrtc-ip-handling-policy=disable_non_proxied_udp');
    expect(launchArgs({ proxy: { server: 'http://127.0.0.1:9' } })).toEqual([...browserOwnerArgs(), WEBRTC_PROXY_ONLY]);
  });

  it('without one: only the owner switch, as before', () => {
    expect(launchArgs({})).toEqual(browserOwnerArgs());
    expect(launchArgs({ locale: 'de-DE', timezoneId: 'Europe/Berlin' })).not.toContain(WEBRTC_PROXY_ONLY);
  });
});
