import { describe, it, expect } from 'vitest';
import { runExportUrl } from './export-url';

describe('runExportUrl', () => {
  it('points at the api-server export route for CSV', () => {
    expect(runExportUrl('3f1c2b4a-1111-4111-8111-111111111111', 'csv'))
      .toMatch(/\/export\/runs\/3f1c2b4a-1111-4111-8111-111111111111\.csv$/);
  });

  it('points at the api-server export route for JSON', () => {
    expect(runExportUrl('3f1c2b4a-1111-4111-8111-111111111111', 'json'))
      .toMatch(/\/export\/runs\/3f1c2b4a-1111-4111-8111-111111111111\.json$/);
  });

  it('is absolute, since the SPA and the api-server are different origins', () => {
    expect(runExportUrl('3f1c2b4a-1111-4111-8111-111111111111', 'csv')).toMatch(/^https?:\/\//);
  });
});
