export type SchemaFieldLite = {
  name: string;
  type: string;
  tier: 'requested' | 'discovered';
};

export type ResultRow = {
  name: string;
  type: string;
  value: unknown;
  status: 'found' | 'not_found';
  source: string | null;
};

export type BuildResultRowsInput = {
  schemaFields: SchemaFieldLite[];
  finalData: Record<string, unknown>;
  sources: Record<string, string>;
};

export type BuildResultRowsOutput = {
  requested: ResultRow[];
  discovered: ResultRow[];
};

function toRow(field: SchemaFieldLite, finalData: Record<string, unknown>, sources: Record<string, string>): ResultRow {
  const raw = finalData[field.name];
  const resolved = raw !== undefined && raw !== null;
  return {
    name: field.name,
    type: field.type,
    value: resolved ? raw : null,
    status: resolved ? 'found' : 'not_found',
    source: sources[field.name] ?? null,
  };
}

export function buildResultRows(input: BuildResultRowsInput): BuildResultRowsOutput {
  const requested: ResultRow[] = [];
  const discovered: ResultRow[] = [];
  for (const field of input.schemaFields) {
    const row = toRow(field, input.finalData, input.sources);
    if (field.tier === 'requested') requested.push(row);
    else discovered.push(row);
  }
  return { requested, discovered };
}
