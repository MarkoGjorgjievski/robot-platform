import { describe, it, expect } from 'vitest';
import { shownTextFromHtml, shownKey, sameShownText, tidyShownText } from './shown-text.js';

describe('shownTextFromHtml — one rule for a heading and a shown value (final review I1/I2)', () => {
  it('every tag is a space, so separate spans never glue', () => {
    expect(shownTextFromHtml('<span class="brand">Nike</span><span class="name">Air Max 90</span>')).toBe('Nike Air Max 90');
    expect(shownTextFromHtml('Widget<br>A')).toBe('Widget A');
  });
  it('a symbol mark in its own element attaches to the word before it', () => {
    expect(shownTextFromHtml('Crusher<span class="marks">®</span> 720')).toBe('Crusher® 720');
    expect(shownTextFromHtml('CottonMove <sup>™</sup> tee')).toBe('CottonMove™ tee');
    expect(shownTextFromHtml('Acme<sup>&copy;</sup>')).toBe('Acme©');
  });
  it('entities are decoded; scripts and styles dropped', () => {
    expect(shownTextFromHtml('<p>Salt &amp; Pepper&nbsp;Mill &#174;</p><script>"x"</script><style>.y{}</style>')).toBe('Salt & Pepper Mill®');
  });
});

describe('shownKey / sameShownText', () => {
  it('folds the space on either side of a mark, NFKC after, lower case', () => {
    expect(shownKey('Crusher ® 720')).toBe(shownKey('Crusher®720'));
    expect(sameShownText('Crusher® 720', 'crusher ® 720')).toBe(true);
    expect(sameShownText('CottonMove™ Tee', 'cottonmove ™ tee')).toBe(true);
    expect(sameShownText('Nike Air Max 90', 'Nike Air Max 91')).toBe(false);
  });
  it('tidyShownText keeps the space after a mark', () => {
    expect(tidyShownText('  Crusher ®   720 ')).toBe('Crusher® 720');
  });
});
