import { describe, it, expect } from 'vitest';
import { db } from '@robot/db';
import { loadRunExport } from './load-run-export.js';

describe('loadRunExport', () => {
  it('returns null for a run id that does not exist', async () => {
    expect(await loadRunExport(db, '00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});
