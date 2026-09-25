import { describe, it, expect } from 'vitest';
import { SITE_TABS, activeTab } from './site-nav-view';
import { crumbs } from './project-nav-view';

describe('site tabs', () => {
  it('names the four tabs in order, Verification exact', () => {
    expect(SITE_TABS.map((t) => [t.label, t.exact])).toEqual([['Verification', true], ['Extract', false], ['Runs', false], ['Settings', false]]);
  });
  it('resolves the active tab from the path, a run page under Runs', () => {
    const base = '/projects/acne/sites/ikea';
    expect(activeTab(base, base)).toBe('Verification');
    expect(activeTab(`${base}/extract`, base)).toBe('Extract');
    expect(activeTab(`${base}/runs`, base)).toBe('Runs');
    expect(activeTab(`${base}/runs/abc`, base)).toBe('Runs');
    expect(activeTab(`${base}/settings`, base)).toBe('Settings');
  });
});

describe('crumbs with a website', () => {
  it('adds the website after the project', () => {
    expect(crumbs('Acme', { name: 'Prices', slug: 'prices' }, { name: 'Ikea', slug: 'ikea' })).toEqual([
      { label: 'Acme' },
      { label: 'Prices', to: '/projects/$project', params: { project: 'prices' } },
      { label: 'Ikea', to: '/projects/$project/sites/$site', params: { project: 'prices', site: 'ikea' } },
    ]);
  });
});
