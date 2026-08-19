// InputSet rows + strategy + template → the URL each input starts from.
//
// A broken row is reported, never guessed at: emitting a URL with an unresolved
// {placeholder} in it would spend a page load to fetch a 404.

export type InputStrategy = 'direct' | 'template' | 'category' | 'search';

export type InputSetColumn = { name: string; primary?: boolean; propagate?: boolean };

export type StartUrl = {
  url: string;
  inputIndex: number;
  inputValues: Record<string, unknown>;
};

export type BuildInputUrlsResult = {
  urls: StartUrl[];
  errors: Array<{ inputIndex: number; message: string }>;
};

export type BuildInputUrlsArgs = {
  strategy: InputStrategy;
  urlTemplate: string | null;
  columns: InputSetColumn[];
  rows: Array<Record<string, unknown>>;
};

const PLACEHOLDER_RE = /\{([^}]+)\}/g;

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function buildInputUrls(args: BuildInputUrlsArgs): BuildInputUrlsResult {
  const { strategy, urlTemplate, columns, rows } = args;
  const primary = columns.find((c) => c.primary) ?? columns[0];
  const urls: StartUrl[] = [];
  const errors: BuildInputUrlsResult['errors'] = [];

  rows.forEach((row, inputIndex) => {
    if (strategy === 'direct') {
      const value = String(row[primary?.name ?? ''] ?? '');
      if (!isAbsoluteHttpUrl(value)) {
        errors.push({ inputIndex, message: `not an absolute http(s) URL: ${value}` });
        return;
      }
      urls.push({ url: value, inputIndex, inputValues: row });
      return;
    }

    if (!urlTemplate) {
      errors.push({ inputIndex, message: 'source has no url_template' });
      return;
    }

    let unresolved: string | null = null;
    const url = urlTemplate.replace(PLACEHOLDER_RE, (match, name: string) => {
      const value = row[name];
      if (value === undefined || value === null || value === '') {
        unresolved ??= match;
        return match;
      }
      // Encoded because a category slug or search query may contain spaces and
      // punctuation that would otherwise change the URL's structure.
      return encodeURIComponent(String(value));
    });

    if (unresolved) {
      errors.push({ inputIndex, message: `unresolved placeholder: ${unresolved}` });
      return;
    }
    if (!isAbsoluteHttpUrl(url)) {
      errors.push({ inputIndex, message: `not an absolute http(s) URL: ${url}` });
      return;
    }
    urls.push({ url, inputIndex, inputValues: row });
  });

  return { urls, errors };
}
