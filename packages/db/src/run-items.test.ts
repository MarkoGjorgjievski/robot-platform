import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import type { IndexedColumn } from 'drizzle-orm/pg-core';
import { runItems } from './schema.js';

describe('run_items table', () => {
  it('is named run_items', () => {
    expect(getTableConfig(runItems).name).toBe('run_items');
  });

  it('carries every column the crawler needs', () => {
    const columns = getTableConfig(runItems).columns.map((c) => c.name).sort();
    expect(columns).toEqual([
      'absent_fields', 'attempts', 'completed_at', 'created_at', 'error', 'extraction_id', 'id',
      'input_index', 'input_values', 'kind', 'listing_values', 'page_number',
      'parent_id', 'run_id', 'started_at', 'status', 'target_fields', 'url',
    ]);
  });

  it('defaults a new item to pending with zero attempts', () => {
    const config = getTableConfig(runItems);
    const status = config.columns.find((c) => c.name === 'status');
    const attempts = config.columns.find((c) => c.name === 'attempts');
    expect(status?.default).toBe('pending');
    expect(attempts?.default).toBe(0);
  });

  it('enforces one row per URL per run, so the same product on two pages queues once', () => {
    const config = getTableConfig(runItems);
    const index = config.indexes.find((i) => i.config.name === 'run_items_run_url_idx');
    expect(index).toBeDefined();
    expect(index?.config.unique).toBe(true);
    // `IndexConfig.columns` is typed `Partial<IndexedColumn | SQL>[]` — raw SQL expressions
    // have no `.name`, so narrow to the entries that are actual indexed columns before reading it.
    const indexedColumns = (index?.config.columns ?? []).filter(
      (c): c is IndexedColumn => 'name' in c,
    );
    expect(indexedColumns.map((c) => c.name)).toEqual(['run_id', 'url']);
  });
});
