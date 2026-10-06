import { describe, it, expect } from 'vitest';
import { PROJECT_NAV, crumbs } from './project-nav-view';

describe('project navigation', () => {
  it('has the four project screens, the home exact', () => {
    expect(PROJECT_NAV.map((i) => [i.label, i.exact])).toEqual([
      ['Websites', true],
      ['Fields', false],
      ['Output', false],
      ['Settings', false],
    ]);
  });

  it('crumbs are org alone outside a project, org then project inside one', () => {
    expect(crumbs('Acme', null)).toEqual([{ label: 'Acme' }]);
    expect(crumbs('Acme', { name: 'Prices', slug: 'prices' })).toEqual([{ label: 'Acme' }, { label: 'Prices', to: '/projects/$project', params: { project: 'prices' } }]);
  });
});
