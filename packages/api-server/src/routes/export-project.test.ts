import { describe, it, expect } from 'vitest';
import { createExportRoutes } from './export.js';
import type { ProjectExport } from '@robot/api/export';

const sample: ProjectExport = {
  project: { id: '11111111-1111-1111-1111-111111111111', name: 'Acme', slug: 'acme' },
  fields: ['Website', 'Title', 'Price'],
  rows: [{ Website: 'Alpha', Title: 'Chair, oak', Price: '10' }],
  websites: [{ id: 'a', name: 'Alpha', slug: 'alpha', runId: 'r', completedAt: '2026-09-02T00:00:00.000Z', rowCount: 1 }],
  rowCount: 1,
  generatedAt: '2026-09-21T10:00:00.000Z',
};
const app = createExportRoutes({
  loadRunExport: async () => null,
  loadProjectExport: async (id) => (id === sample.project.id ? sample : null),
});

describe('GET /export/projects/:file', () => {
  it('serves CSV with the project filename', async () => {
    const res = await app.request(`/projects/${sample.project.id}.csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="acme-2026-09-21.csv"');
    const text = await res.text();
    expect(text).toContain('Website,Title,Price');
    expect(text).toContain('Alpha,"Chair, oak",10');
  });

  it('serves JSON', async () => {
    const res = await app.request(`/projects/${sample.project.id}.json`);
    expect(res.status).toBe(200);
    expect((await res.json()).rowCount).toBe(1);
  });

  it('serves xlsx with the project filename and content type', async () => {
    const res = await app.request(`/projects/${sample.project.id}.xlsx`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="acme-2026-09-21.xlsx"');
  });

  it('404s an unknown project, a malformed id and an unknown format', async () => {
    expect((await app.request('/projects/22222222-2222-2222-2222-222222222222.csv')).status).toBe(404);
    expect((await app.request('/projects/not-a-uuid.csv')).status).toBe(404);
    expect((await app.request(`/projects/${sample.project.id}.pdf`)).status).toBe(404);
  });
});
