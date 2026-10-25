// A website's country and stealth (Task 2 review, minor 8): if the per-locale evasions cannot be loaded, the browser
// keeps the default stealth (en-US disguise, the context's own locale) — never no stealth — and says so once.
import { describe, it, expect, vi } from 'vitest';
import { localeStealthLauncher, stealthChromium } from './playwright-browser.js';

describe('localeStealthLauncher', () => {
  it('falls back to the default stealth launcher, with one warning however often it is asked', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const broken = () => Promise.reject(new Error('Cannot find module evasions'));
      const a = await localeStealthLauncher('de-DE', broken);
      const b = await localeStealthLauncher('fr-FR', broken);
      const shared = await stealthChromium();
      expect(a).toBe(shared);
      expect(b).toBe(shared);
      const { chromium: vanilla } = await import('playwright');
      expect(shared).not.toBe(vanilla);
      expect(warn.mock.calls.filter((c) => /per-locale stealth/.test(String(c[0])))).toHaveLength(1);
    } finally { warn.mockRestore(); }
  });

  it('with the evasions: its own launcher, not the default one', async () => {
    expect(await localeStealthLauncher('de-DE')).not.toBe(await stealthChromium());
  });
});
