import { describe, it, expect } from 'vitest';
import { buildResultRows } from './build-result-rows.js';

const requested = (name: string, type = 'string') => ({ name, type, tier: 'requested' as const });
const discovered = (name: string, type = 'string') => ({ name, type, tier: 'discovered' as const });

describe('buildResultRows', () => {
  it('emits all requested fields with null + not_found when unresolved', () => {
    const out = buildResultRows({
      schemaFields: [requested('price'), requested('title')],
      finalData: { price: '$24.99' },
      sources: { price: 'api' },
    });
    expect(out.requested).toEqual([
      { name: 'price', type: 'string', value: '$24.99', status: 'found', source: 'api' },
      { name: 'title', type: 'string', value: null, status: 'not_found', source: null },
    ]);
    expect(out.discovered).toEqual([]);
  });

  it('emits all discovered fields with null + not_found when unresolved', () => {
    const out = buildResultRows({
      schemaFields: [discovered('sizes'), discovered('flavours')],
      finalData: { sizes: ['S', 'M', 'L'] },
      sources: { sizes: 'xpath' },
    });
    expect(out.discovered).toEqual([
      { name: 'sizes', type: 'string', value: ['S', 'M', 'L'], status: 'found', source: 'xpath' },
      { name: 'flavours', type: 'string', value: null, status: 'not_found', source: null },
    ]);
    expect(out.requested).toEqual([]);
  });

  it('treats null value as not_found, not as a successful empty hit', () => {
    const out = buildResultRows({
      schemaFields: [requested('description')],
      finalData: { description: null },
      sources: {},
    });
    expect(out.requested[0]).toMatchObject({ status: 'not_found', value: null });
  });

  it('treats undefined value identically to missing key', () => {
    const out = buildResultRows({
      schemaFields: [discovered('weight')],
      finalData: { weight: undefined } as Record<string, unknown>,
      sources: {},
    });
    expect(out.discovered[0]).toMatchObject({ status: 'not_found', value: null });
  });

  it('partitions strictly by tier — a discovered field with same name as a requested one stays in its tier', () => {
    const out = buildResultRows({
      schemaFields: [requested('price'), discovered('sizes')],
      finalData: { price: '$24.99', sizes: ['S'] },
      sources: { price: 'api', sizes: 'xpath' },
    });
    expect(out.requested.map(r => r.name)).toEqual(['price']);
    expect(out.discovered.map(r => r.name)).toEqual(['sizes']);
  });
});
