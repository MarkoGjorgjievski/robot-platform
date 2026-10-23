import { describe, it, expect, afterEach } from 'vitest';
import { PlaywrightBrowser } from './playwright-browser.js';
import { forbidBrowserLaunch, allowBrowserLaunch, BrowserForbiddenError } from './launch-guard.js';

afterEach(() => allowBrowserLaunch());

describe('the launch guard', () => {
  it('a forbidden process cannot launch Chromium — the launch throws before any process starts', async () => {
    forbidBrowserLaunch('The api-server never starts a browser.');
    const b = new PlaywrightBrowser();
    await expect(b.launch({ headless: true })).rejects.toBeInstanceOf(BrowserForbiddenError);
    await b.close(); // null-safe: nothing was launched
  });
});
