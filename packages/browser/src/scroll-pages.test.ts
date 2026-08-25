import { describe, it, expect } from 'vitest';
import { unseenXpath, rowCountScript, stampScript, scopeExtractionScript, SEEN_ATTR } from './scroll-pages.js';

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

  it('embeds the xpath as data, not as code', () => {
    // A selector carrying a quote must not be able to close the string and run.
    // Mirrors stampScript's own nasty-xpath test below — rowCountScript had no
    // equivalent, so a naive `"${rowXpath}"` interpolation here would emit a
    // syntax error at page.evaluate() time for a selector like this one,
    // silently breaking the growth count.
    const nasty = `//div[@class="a'b"]`;
    expect(rowCountScript(nasty)).toContain(JSON.stringify(nasty));
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

  it('embeds SEEN_ATTR as data, not as code', () => {
    // Same class of bug as the xpath above, on the SECOND embedded argument
    // (setAttribute's name). Today's SEEN_ATTR value happens to contain no
    // quote, so a naive `'${SEEN_ATTR}'` template would still run — this
    // asserts the JSON.stringify form specifically (note the double quotes),
    // which a naive single-quoted interpolation would not produce, so the
    // check does not depend on SEEN_ATTR ever containing a quote to catch it.
    expect(stampScript('//div[@data-row]')).toContain(JSON.stringify(SEEN_ATTR));
  });
});

describe('scopeExtractionScript', () => {
  const ROW_XPATH = '//div[@data-row]';

  it('rewrites the rowXpath ASSIGNMENT, not merely the first occurrence of the xpath text', () => {
    // The xpath text appears once earlier — a decoy assignment for an unrelated
    // variable — before the real `const rowXpath = "...";` assignment that
    // buildExtractionScript emits (see executor.ts). String.replace with a
    // string pattern rewrites only the first match; if this function did that
    // naively against the bare xpath text, it would rewrite the decoy and
    // leave the actual assignment (and thus the scoping) untouched.
    const extractionScript = [
      `const decoy = ${JSON.stringify(ROW_XPATH)};`,
      `const rowXpath = ${JSON.stringify(ROW_XPATH)};`,
      `const pageType = "auto";`,
    ].join('\n');

    const scoped = scopeExtractionScript(extractionScript, ROW_XPATH);

    // The decoy is untouched.
    expect(scoped).toContain(`const decoy = ${JSON.stringify(ROW_XPATH)};`);
    // The real assignment is scoped to unseen rows.
    expect(scoped).toContain(`const rowXpath = ${JSON.stringify(unseenXpath(ROW_XPATH))};`);
    expect(scoped).not.toContain(`const rowXpath = ${JSON.stringify(ROW_XPATH)};`);
  });

  it('forces LISTING mode', () => {
    const extractionScript = `const rowXpath = ${JSON.stringify(ROW_XPATH)};\nconst pageType = "detail";`;
    expect(scopeExtractionScript(extractionScript, ROW_XPATH)).toContain('const pageType = "listing";');
  });
});
