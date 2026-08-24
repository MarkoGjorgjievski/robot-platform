import { describe, it, expect } from 'vitest';
import { unseenXpath, rowCountScript, stampScript, SEEN_ATTR } from './scroll-pages.js';

describe('unseenXpath', () => {
  it('scopes an xpath to rows that have not been stamped', () => {
    expect(unseenXpath('//div[@data-row]')).toBe(`//div[@data-row][not(@${SEEN_ATTR})]`);
  });

  it('leaves the original xpath otherwise untouched', () => {
    // The predicate is appended, never woven in — page 1's plan is the caller's,
    // and rewriting it would break selectors this module does not understand.
    const original = '//div[contains(@class,"item")]/section[1]';
    expect(unseenXpath(original).startsWith(original)).toBe(true);
  });
});

describe('rowCountScript', () => {
  it('counts ALL rows, stamped or not', () => {
    // Growth is measured against the whole list, not the unstamped remainder:
    // after a round stamps everything, the unstamped count is 0 and would look
    // like the list had shrunk.
    const script = rowCountScript('//div[@data-row]');
    expect(script).toContain('//div[@data-row]');
    expect(script).not.toContain(SEEN_ATTR);
  });
});

describe('stampScript', () => {
  it('stamps every row matching the caller\'s xpath', () => {
    expect(stampScript('//div[@data-row]')).toContain(SEEN_ATTR);
    expect(stampScript('//div[@data-row]')).toContain('//div[@data-row]');
  });

  it('embeds the xpath as data, not as code', () => {
    // A selector carrying a quote must not be able to close the string and run.
    const nasty = `//div[@class="a'b"]`;
    expect(stampScript(nasty)).toContain(JSON.stringify(nasty));
  });
});
