export type QuickExtractionRow = {
  url: string;
  domain: string;
  fields: unknown;
  extractedData: unknown;
};

export type SandboxSourceRecord = {
  datasetId: null;
  inputSetId: null;
  isSandbox: true;
  inputStrategy: 'direct';
  urlTemplate: string;
  listingMode: 'detail';
  name: string;
  slug: string;
  selectorsJson: { fields: unknown };
};

export type InlineInputSetRecord = {
  projectId: string;
  type: 'direct';
  name: string;
  columns: Array<{ name: string; primary: boolean; type: string }>;
  rows: Array<Record<string, string>>;
  isInline: true;
};

export type BackfillResult = {
  sources: SandboxSourceRecord[];
  inputSets: InlineInputSetRecord[];
  /** Parallel array: sources[i] corresponds to inputSets[sourceToInputSetIndex[i]]. */
  sourceToInputSetIndex: number[];
};

export function slugifyDomain(domain: string): string {
  return domain
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function shortRandomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

function deriveName(url: string, domain: string): string {
  let pathPart = '';
  try {
    const parsed = new URL(url);
    pathPart = parsed.pathname && parsed.pathname !== '/' ? ` ${parsed.pathname}` : '';
  } catch {
    // ignore malformed URLs
  }
  return `${domain}${pathPart}`;
}

export function quickExtractionsToSandboxRecords(
  rows: QuickExtractionRow[],
  sandboxProjectId: string,
): BackfillResult {
  const seen = new Map<string, number>();
  const sources: SandboxSourceRecord[] = [];
  const inputSets: InlineInputSetRecord[] = [];
  const sourceToInputSetIndex: number[] = [];

  for (const row of rows) {
    if (seen.has(row.url)) continue;
    seen.set(row.url, sources.length);

    const inputSet: InlineInputSetRecord = {
      projectId: sandboxProjectId,
      type: 'direct',
      name: `inline:${row.url}`,
      columns: [{ name: 'url', primary: true, type: 'string' }],
      rows: [{ url: row.url }],
      isInline: true,
    };
    inputSets.push(inputSet);

    sources.push({
      datasetId: null,
      inputSetId: null, // filled in at write time once the InputSet has an id
      isSandbox: true,
      inputStrategy: 'direct',
      urlTemplate: row.url,
      listingMode: 'detail',
      name: deriveName(row.url, row.domain),
      slug: `${slugifyDomain(row.domain)}-${shortRandomSuffix()}`,
      selectorsJson: { fields: row.fields },
    });
    sourceToInputSetIndex.push(inputSets.length - 1);
  }

  return { sources, inputSets, sourceToInputSetIndex };
}
