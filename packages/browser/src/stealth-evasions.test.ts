import { describe, it, expect } from 'vitest';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { STEALTH_EVASIONS_OFF, stealthPlugin } from './playwright-browser.js';

describe('stealthPlugin (2026-10-16)', () => {
  it('leaves iframe.contentWindow off — with user-agent-override it laid Ruggable, Ridge and Mejuri out 4000 px wide', () => {
    expect(STEALTH_EVASIONS_OFF).toContain('iframe.contentWindow');
    const plugin = stealthPlugin(() => StealthPlugin());
    expect([...plugin.enabledEvasions]).not.toContain('iframe.contentWindow');
  });

  it('keeps every other evasion, the user-agent override and webdriver among them', () => {
    const all = [...StealthPlugin().enabledEvasions];
    const kept = [...stealthPlugin(() => StealthPlugin()).enabledEvasions];
    expect(kept).toEqual(all.filter((e) => !(STEALTH_EVASIONS_OFF as readonly string[]).includes(e)));
    expect(kept).toEqual(expect.arrayContaining(['user-agent-override', 'navigator.webdriver']));
  });
});
