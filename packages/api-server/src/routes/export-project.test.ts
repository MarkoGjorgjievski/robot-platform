import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { createExportRoutes } from './export.js';
import type { ProjectExport } from '@robot/api/export';
import type { SessionInfo } from '@robot/api/auth';

const sample: ProjectExport = {
  project: { id: '11111111-1111-1111-1111-111111111111', name: 'Acme', slug: 'acme' },
  fields: ['Website', 'Title', 'Price'],
  rows: [{ Website: 'Alpha', Title: 'Chair, oak', Price: '10' }],
  websites: [{ id: 'a', name: 'Alpha', slug: 'alpha', runId: 'r', completedAt: '2026-09-02T00:00:00.000Z', rowCount: 1 }],
  rowCount: 1,
  generatedAt: '2026-09-21T10:00:00.000Z',
  types: { Title: 'text', Price: 'money' },
  nested: false,
};
const SESSION: SessionInfo = {
  token: 't',
  user: { id: 'u1', email: 'owner@example.com', name: 'Owner', avatarColour: '#000', theme: 'light' },
  org: { id: 'org-1', slug: 'owner-org', name: 'Owner Org', personal: true },
  role: 'owner',
};
const COOKIE = { cookie: 'robot_session=valid-token' };
const nestedId = '33333333-3333-3333-3333-333333333333';

const app = createExportRoutes({
  loadRunExport: async () => null,
  loadProjectExport: async (id) => (id === sample.project.id ? sample : null),
  loadSession: async () => SESSION,
  orgIdForProject: async (id) => (id === sample.project.id || id === nestedId ? SESSION.org.id : null),
  orgIdForRun: async () => null,
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

  // Final review M5: `types` is for the xlsx writer only — the JSON keeps the
  // shape it had before variants (no new key for any project).
  it('leaves the xlsx types map out of the JSON envelope', async () => {
    const res = await app.request(`/projects/${sample.project.id}.json`);
    const body = await res.json();
    expect(body).not.toHaveProperty('types');
    expect(Object.keys(body).sort()).toEqual(['fields', 'generatedAt', 'project', 'rowCount', 'rows', 'websites']);
  });

  it('serves xlsx with the project filename and content type', async () => {
    const res = await app.request(`/projects/${sample.project.id}.xlsx`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="acme-2026-09-21.xlsx"');
  });

  // Fix round 1 (spec): the project's xlsx types a money column as a real
  // Excel number, same as a run's own xlsx export.
  it('stores a money column as a real number in the project xlsx, using the types map', async () => {
    const res = await app.request(`/projects/${sample.project.id}.xlsx`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const workbook = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(buffer as any);
    const sheet = workbook.getWorksheet('Data')!;
    const priceCell = sheet.getRow(2).getCell(3).value;
    expect(priceCell).toBe(10);
    expect(typeof priceCell).toBe('number');
  });

  it('404s an unknown project, a malformed id and an unknown format', async () => {
    expect((await app.request('/projects/22222222-2222-2222-2222-222222222222.csv')).status).toBe(404);
    expect((await app.request('/projects/not-a-uuid.csv')).status).toBe(404);
    expect((await app.request(`/projects/${sample.project.id}.pdf`)).status).toBe(404);
  });

  // D2 (live check, 2026-10-05): a project whose dataset exports nested marks
  // its file name as lossy, same wording as a single run's.
  describe('a project with a nested-shape website', () => {
    const nestedSample: ProjectExport = { ...sample, project: { ...sample.project, id: nestedId }, nested: true };
    const nestedApp = createExportRoutes({
      loadRunExport: async () => null,
      loadProjectExport: async (id) => (id === nestedSample.project.id ? nestedSample : null),
      loadSession: async () => SESSION,
      orgIdForProject: async (id) => (id === nestedSample.project.id ? SESSION.org.id : null),
      orgIdForRun: async () => null,
    });

    it('names the json "-variants-nested" and the csv/xlsx "-variants-joined"', async () => {
      expect((await nestedApp.request(`/projects/${nestedSample.project.id}.json`)).headers.get('content-disposition'))
        .toBe('attachment; filename="acme-2026-09-21-variants-nested.json"');
      expect((await nestedApp.request(`/projects/${nestedSample.project.id}.csv`)).headers.get('content-disposition'))
        .toBe('attachment; filename="acme-2026-09-21-variants-joined.csv"');
      expect((await nestedApp.request(`/projects/${nestedSample.project.id}.xlsx`)).headers.get('content-disposition'))
        .toBe('attachment; filename="acme-2026-09-21-variants-joined.xlsx"');
    });
  });
});

// Final review I1: gated the same way as the run route — signed out is 401, a
// project belonging to another org is 404 indistinguishably from one that
// doesn't exist, and the owning org's session gets a 200 in every format.
describe('GET /export/projects/:file session gating', () => {
  const noSessionApp = createExportRoutes({
    loadRunExport: async () => null,
    loadProjectExport: async (id) => (id === sample.project.id ? sample : null),
    loadSession: async () => null,
    orgIdForProject: async (id) => (id === sample.project.id ? SESSION.org.id : null),
    orgIdForRun: async () => null,
  });
  const otherOrgApp = createExportRoutes({
    loadRunExport: async () => null,
    loadProjectExport: async (id) => (id === sample.project.id ? sample : null),
    loadSession: async () => SESSION,
    orgIdForProject: async () => 'some-other-org',
    orgIdForRun: async () => null,
  });

  for (const format of ['csv', 'json', 'xlsx'] as const) {
    it(`responds 401 for ${format} with no session`, async () => {
      const res = await noSessionApp.request(`/projects/${sample.project.id}.${format}`);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'Sign in first' });
    });

    it(`responds 404 for ${format} when the project belongs to another org`, async () => {
      const res = await otherOrgApp.request(`/projects/${sample.project.id}.${format}`, { headers: COOKIE });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'Project not found' });
    });

    it(`responds 200 for ${format} when the session's org owns the project`, async () => {
      const res = await app.request(`/projects/${sample.project.id}.${format}`, { headers: COOKIE });
      expect(res.status).toBe(200);
    });
  }
});
