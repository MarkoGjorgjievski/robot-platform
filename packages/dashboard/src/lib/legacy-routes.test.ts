import { describe, it, expect } from 'vitest';
import { legacyTarget } from './legacy-routes';

describe('legacyTarget', () => {
  it('maps the project root', () => {
    expect(legacyTarget('/p/scratch')).toBe('/projects/scratch');
    expect(legacyTarget('/p/scratch/')).toBe('/projects/scratch');
  });
  it('maps sources and the renamed tabs', () => {
    expect(legacyTarget('/p/scratch/sources')).toBe('/projects/scratch/sources');
    expect(legacyTarget('/p/scratch/sources/abc')).toBe('/projects/scratch/sources/abc');
    expect(legacyTarget('/p/scratch/sources/abc/setup')).toBe('/projects/scratch/sources/abc');
    expect(legacyTarget('/p/scratch/sources/abc/config')).toBe('/projects/scratch/sources/abc/settings');
    expect(legacyTarget('/p/scratch/sources/abc/overview')).toBe('/projects/scratch/sources/abc/extract');
    expect(legacyTarget('/p/scratch/sources/abc/runs')).toBe('/projects/scratch/sources/abc/runs');
    expect(legacyTarget('/p/scratch/sources/abc/runs/r1')).toBe('/projects/scratch/sources/abc/runs/r1');
  });
  it('maps datasets to output and domains to ops', () => {
    expect(legacyTarget('/p/scratch/datasets')).toBe('/projects/scratch/output');
    expect(legacyTarget('/p/scratch/datasets/d1')).toBe('/projects/scratch/output');
    expect(legacyTarget('/domains')).toBe('/ops/domains');
    expect(legacyTarget('/domains/www.newegg.com')).toBe('/ops/domains/www.newegg.com');
  });
  it('sends the removed inputs screens to the project', () => {
    expect(legacyTarget('/p/scratch/inputs')).toBe('/projects/scratch');
    expect(legacyTarget('/p/scratch/inputs/i1')).toBe('/projects/scratch');
  });
  it('returns null for anything else', () => {
    expect(legacyTarget('/projects')).toBeNull();
    expect(legacyTarget('/projects/scratch')).toBeNull();
    expect(legacyTarget('/')).toBeNull();
  });
});
