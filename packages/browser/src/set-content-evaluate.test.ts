import { describe, it, expect } from 'vitest';
import { PlaywrightBrowser } from './playwright-browser.js';

describe('setContentEvaluate', () => {
  it('runs an XPath against given HTML offline (no navigation)', async () => {
    const browser = new PlaywrightBrowser();
    await browser.launch({ headless: true });
    try {
      const html = '<html><body><div id="probe"><span class="v">hello</span></div></body></html>';
      const script = `
        (() => {
          const r = document.evaluate('//span[@class="v"]', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
          return r.singleNodeValue ? r.singleNodeValue.textContent : null;
        })()
      `;
      const result = await browser.setContentEvaluate<string | null>(html, script);
      expect(result).toBe('hello');
    } finally {
      await browser.close();
    }
  }, 30_000);
});
