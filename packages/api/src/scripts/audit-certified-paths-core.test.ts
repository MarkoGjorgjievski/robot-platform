import { describe, it, expect } from 'vitest';
import type { VerificationSet } from '@robot/scraper';
import { auditField } from './audit-certified-paths-core.js';

const urls = ['https://www.ikea.com/my/en/p/a', 'https://www.ikea.com/my/en/p/b', 'https://www.ikea.com/my/en/p/c'];
const every = (v: string) => Object.fromEntries(urls.map((u) => [u, v]));

const set: VerificationSet = {
  urls,
  expected: {
    in_stock: every('true'),
    price: { [urls[0]!]: '199', [urls[1]!]: '249', [urls[2]!]: '349' },
    currency: every('MYR'),
  },
};

const inStock = { key: 'in_stock', name: 'In stock', type: 'boolean' as const, concept: 'availability' };

describe('auditField', () => {
  it('flags a yes/no field certified on a path that does not name it (Ikea: priority)', () => {
    const row = auditField({ website: 'ikea', field: inStock, set, certified: [{ source: 'api', path: 'products[0].priority' }] });
    expect(row).toMatchObject({ website: 'ikea', field: 'In stock', paths: ['api products[0].priority'], ok: false });
    expect(row.why).toMatch(/yes\/no field certified on paths that do not name it/);
    expect(row.why).toContain('products[0].priority');
  });

  it('passes a yes/no field certified on offers.availability', () => {
    const row = auditField({ website: 'ikea', field: inStock, set, certified: [{ source: 'json-ld', path: 'offers.availability' }] });
    expect(row).toMatchObject({ ok: true, paths: ['json-ld offers.availability'] });
    expect(row.why).toBeUndefined();
  });

  it('passes a money field whatever its path is called: values tell its paths apart', () => {
    const row = auditField({ website: 'ikea', field: { key: 'price', name: 'Price', type: 'money', concept: 'price' }, set, certified: [{ source: 'xpath', path: '//span[@class="x"]' }] });
    expect(row.ok).toBe(true);
  });

  it('flags a field whose proof pages share one value, certified on an unmarked page element', () => {
    const row = auditField({ website: 'ikea', field: { key: 'currency', name: 'Currency', type: 'text', concept: 'currency' }, set, certified: [{ source: 'xpath', path: '//span[1]' }] });
    expect(row.ok).toBe(false);
    expect(row.why).toMatch(/same value on every product/);
  });

  it('passes a weak field on a path the customer confirmed or an element they marked', () => {
    const withChoices: VerificationSet = {
      ...set,
      paths: { in_stock: { [urls[0]!]: { source: 'api', path: 'products[0].priority' } } },
      marks: { currency: { [urls[0]!]: { xpaths: ['//span[1]'], text: 'MYR', rect: { x: 0, y: 0, w: 1, h: 1 } } } },
    };
    expect(auditField({ website: 'ikea', field: inStock, set: withChoices, certified: [{ source: 'api', path: 'products[0].priority' }] }).ok).toBe(true);
    expect(auditField({ website: 'ikea', field: { key: 'currency', name: 'Currency', type: 'text', concept: 'currency' }, set: withChoices, certified: [{ source: 'xpath', path: '//span[1]' }] }).ok).toBe(true);
  });

  it('flags when any one of several certified paths does not qualify', () => {
    const row = auditField({ website: 'ikea', field: inStock, set, certified: [{ source: 'json-ld', path: 'offers.availability' }, { source: 'api', path: 'isNew' }] });
    expect(row.ok).toBe(false);
    expect(row.why).toContain('api isNew');
    expect(row.why).not.toContain('offers.availability');
  });
});
