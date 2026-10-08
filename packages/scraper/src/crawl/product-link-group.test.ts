// The harvest script runs in a real page: Chromium, not a fake. It is
// JavaScript inside a TS template literal, so a single-backslash escape
// silently changes the regex the page receives (`/\s+/` → `/s+/`, which ate
// the "s" in "Men's Tree Runner Shoes").

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PlaywrightBrowser } from '@robot/browser';
import { LISTING_ANCHORS_SCRIPT, type ListingAnchor } from './product-link-group.js';

let browser: PlaywrightBrowser;
beforeAll(async () => {
  browser = new PlaywrightBrowser();
  await browser.launch({ headless: true });
});
afterAll(async () => { await browser?.close(); });

describe('LISTING_ANCHORS_SCRIPT in Chromium', () => {
  it('collapses whitespace in link text and keeps every letter', async () => {
    const anchors = await browser.setContentEvaluate<ListingAnchor[]>(
      '<a href="/p/1">  Shoes  </a><a href="/p/2">Men\'s   Tree\n Runner Shoes</a>',
      LISTING_ANCHORS_SCRIPT,
    );
    expect(anchors.map((a) => a.text)).toEqual(['Shoes', "Men's Tree Runner Shoes"]);
  });
});
