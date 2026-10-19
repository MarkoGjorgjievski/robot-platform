import { describe, it, expect } from 'vitest';
import { normalize, valuesEqual, validateExpected, renderValue, afterLabel, labelled } from './normalize.js';

describe('normalize', () => {
  it('text: trims, collapses whitespace, NFKC; keeps case (comparison folds it)', () => {
    expect(normalize('text', '  Samsung  T7  2TB ')).toBe('Samsung T7 2TB');
    expect(normalize('text', 'ﬁle')).toBe('file');
    expect(valuesEqual('text', 'SAMSUNG t7', 'Samsung T7')).toBe(true);
  });
  it('number: parses both decimal separators and thousands separators', () => {
    expect(normalize('number', '1,299.50')).toBe('1299.5');
    expect(normalize('number', '1.299,50')).toBe('1299.5');
    expect(normalize('number', 1299.5)).toBe('1299.5');
    expect(normalize('number', 'twelve')).toBeNull();
  });
  it('money: strips currency symbols and codes, two decimals', () => {
    expect(normalize('money', '$129.99')).toBe('129.99');
    expect(normalize('money', 'EUR 129,99')).toBe('129.99');
    expect(normalize('money', '129.9949')).toBe('129.99');
    expect(normalize('money', 'call for price')).toBeNull();
  });
  it('money vs number: single dot with exactly 3 trailing digits', () => {
    expect(normalize('money', '1.299')).toBe('1299.00');
    expect(normalize('money', '1.299 €')).toBe('1299.00');
    expect(normalize('number', '1.299')).toBe('1.299');
    expect(normalize('money', '1.299,00')).toBe('1299.00');
    expect(normalize('money', '129.99')).toBe('129.99');
    expect(normalize('money', '129.994')).toBe('129994.00');
    expect(normalize('number', '129.994')).toBe('129.994');
    expect(normalize('money', '129.999')).toBe('129999.00');
    expect(normalize('money', '1299.999')).toBe('1299999.00');
  });
  it('boolean: synonym sets', () => {
    expect(normalize('boolean', 'In Stock')).toBe('true');
    expect(normalize('boolean', 'https://schema.org/InStock')).toBe('true');
    expect(normalize('boolean', 'Out of stock')).toBe('false');
    expect(normalize('boolean', true)).toBe('true');
    expect(normalize('boolean', 'maybe')).toBeNull();
  });
  it('date: calendar day', () => {
    expect(normalize('date', '2026-09-04T13:00:00Z')).toBe('2026-09-04');
    expect(normalize('date', 'September 4, 2026')).toBe('2026-09-04');
    expect(normalize('date', 'not a date')).toBeNull();
  });
  it('date: Date instance normalizes with local components', () => {
    expect(normalize('date', new Date(2026, 8, 4))).toBe('2026-09-04');
  });
  it('url/image: resolves against the page and drops the fragment', () => {
    expect(normalize('url', '/p/1#top', { pageUrl: 'https://shop.example/x' })).toBe('https://shop.example/p/1');
    expect(normalize('image', 'HTTPS://CDN.Example/a.jpg')).toBe('https://cdn.example/a.jpg');
  });
  it('url/image: a bare fragment or a lone dot is not a link, though it resolves to the page itself (Ikea: a colour "#0058a3" and a price separator "." certified as Product URL)', () => {
    const ctx = { pageUrl: 'https://www.ikea.com/my/en/p/baggebo-70483882/' };
    for (const v of ['#0058a3', '#', '.', './', '..', ' . ']) {
      expect(normalize('url', v, ctx)).toBeNull();
      expect(normalize('image', v, ctx)).toBeNull();
      expect(valuesEqual('url', v, ctx.pageUrl, ctx)).toBe(false);
    }
    expect(normalize('url', './other', ctx)).toBe('https://www.ikea.com/my/en/p/baggebo-70483882/other');
  });
  it('text_list: splits on newline, comma, semicolon; set semantics', () => {
    expect(normalize('text_list', 'Red, Blue;Green')).toBe(normalize('text_list', ['green', 'red', 'blue']));
  });
});

describe('valuesEqual', () => {
  it('money within a cent', () => expect(valuesEqual('money', '129.99', 129.994)).toBe(true));
  it('null on either side is never equal', () => expect(valuesEqual('number', 'x', 'x')).toBe(false));
});

describe('images and url objects', () => {
  it('treats image URLs differing only in the query as the same image', () => {
    expect(valuesEqual('image', 'https://www.ikea.com/a/b_s5.jpg?f=s', 'https://www.ikea.com/a/b_s5.jpg')).toBe(true);
    expect(valuesEqual('image', 'https://WWW.ikea.com/a/b.jpg#x', 'https://www.ikea.com/a/b.jpg?w=200')).toBe(true);
    expect(valuesEqual('image', 'https://x.example/img?id=1', 'https://x.example/img?id=2')).toBe(true); // accepted risk (Review Focus 4)
    expect(valuesEqual('image', 'https://x.example/a.jpg', 'https://x.example/b.jpg')).toBe(false);
  });
  it('keeps page URLs exact', () => {
    expect(valuesEqual('url', 'https://x.example/p?id=1', 'https://x.example/p?id=2')).toBe(false);
  });
  it('reads an ImageObject or a url object', () => {
    expect(normalize('image', { '@type': 'ImageObject', url: 'https://x.example/a.jpg' })).toBe('https://x.example/a.jpg');
    expect(normalize('image', { contentUrl: 'https://x.example/b.jpg' })).toBe('https://x.example/b.jpg');
    expect(normalize('url', { '@id': 'https://x.example/p/1' })).toBe('https://x.example/p/1');
    expect(normalize('image', { width: 10 })).toBeNull();
  });
  it('image normalize output keeps the query (only valuesEqual ignores it)', () => {
    expect(normalize('image', 'https://www.ikea.com/a/b_s5.jpg?f=s')).toBe('https://www.ikea.com/a/b_s5.jpg?f=s');
  });
});

describe('validateExpected', () => {
  it('rejects a blank cell for every type', () => {
    expect(validateExpected('text', '   ')).toMatch(/required/i);
  });
  it('rejects a non-money in a money cell', () => {
    expect(validateExpected('money', 'call for price')).toMatch(/money/i);
    expect(validateExpected('money', '$1,299.00')).toBeNull();
  });
  it('accepts any non-blank text', () => expect(validateExpected('text', 'x')).toBeNull());
});

describe('renderValue', () => {
  it('numbers, booleans, lists become typed values', () => {
    expect(renderValue('money', '129.99')).toBe(129.99);
    expect(renderValue('boolean', 'true')).toBe(true);
    expect(renderValue('text_list', ['a', 'b'].join(String.fromCharCode(31)))).toEqual(['a', 'b']);
    expect(renderValue('text', 'hello')).toBe('hello');
  });
});

describe('valuesEqual — rounded numbers (spec 2026-10-17 §7)', () => {
  it('a shown number with decimals matches more precise page data within half its last unit', () => {
    expect(valuesEqual('number', 4.7610064, '4.8')).toBe(true);
    expect(valuesEqual('number', '4.8', '4.7610064')).toBe(true);
    expect(valuesEqual('number', 4.75, '4.8')).toBe(true);    // the half-unit boundary rounds either way
    expect(valuesEqual('number', '4.74', '4.8')).toBe(false);
  });
  it('never rounds a whole number, a further-off value or money', () => {
    expect(valuesEqual('number', '4.9', 4.7610064)).toBe(false);
    expect(valuesEqual('number', '5', 4.6)).toBe(false);
    expect(valuesEqual('money', '4.8', 4.7610064)).toBe(false);
  });
  it('the same precision compares exactly, as today; trailing zeros are the same number', () => {
    expect(valuesEqual('number', '4.7', '4.8')).toBe(false);
    expect(valuesEqual('number', '4.80', 4.8)).toBe(true);
  });
  it('a typed trailing zero counts as a decimal: "5.0" is shown to one decimal', () => {
    expect(normalize('number', '5.0')).toBe('5');            // the stored value is the number
    expect(valuesEqual('number', '5.0', 4.96)).toBe(true);
    expect(valuesEqual('number', 4.96, '5.0')).toBe(true);
    expect(valuesEqual('number', '5.0', 4.94)).toBe(false);
    expect(valuesEqual('number', '5,0', 4.96)).toBe(true);     // a decimal comma reads the same
    expect(valuesEqual('number', '5', 4.96)).toBe(false);      // a whole number still never rounds
  });
});

describe('afterLabel (spec 2026-10-17 §6)', () => {
  it('takes the text after a short digit-free label', () => {
    expect(afterLabel('Style: 398846_01')).toBe('398846_01');
    expect(afterLabel('Art.-Nr.: 12345')).toBe('12345');
    expect(afterLabel('  SKU:ABC-1 ')).toBe('ABC-1');
  });
  it('reads through whitespace and line breaks inside the text, as the element shows it', () => {
    expect(afterLabel('Product\n code: 123')).toBe('123');
    expect(afterLabel('Style:\n  398846_01\n')).toBe('398846_01');
    expect(afterLabel('Model\tnumber:  AB  12')).toBe('AB 12');
  });
  it('none when the label has digits, is too long, or there is no colon', () => {
    expect(afterLabel('Top 5: great')).toBeNull();
    expect(afterLabel('A label that is far too long to be one: x')).toBeNull();
    expect(afterLabel('398846_01')).toBeNull();
    expect(afterLabel('Style:')).toBeNull();
  });
  it('afterLabel leaves a product name with a colon whole: product_name is not labelled', () => {
    expect(labelled('product_name')).toBe(false);
    expect(labelled('description')).toBe(false);
    expect(labelled(undefined)).toBe(false);
    for (const c of ['sku', 'brand', 'availability', 'rating', 'review_count', 'currency']) expect(labelled(c)).toBe(true);
  });
});
