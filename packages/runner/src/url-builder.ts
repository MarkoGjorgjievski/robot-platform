function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

export function buildUrl(
  parameters: Record<string, unknown>,
  inputData: Record<string, unknown>,
): string {
  const template = parameters.URLTemplate as string | undefined;

  if (template) {
    return template.replace(/\{(\w+)\}/g, (match, key) => {
      const value = inputData[key] ?? parameters[key];
      return value !== undefined ? String(value) : match;
    });
  }

  // Accept any common URL key name: _url, URL, url
  const directUrl = (inputData._url ?? inputData.URL ?? inputData.url) as string | undefined;
  if (directUrl) {
    return stripQuotes(directUrl);
  }

  // Fallback: find any input value that looks like a URL (strip surrounding quotes)
  for (const value of Object.values(inputData)) {
    if (typeof value === 'string') {
      const cleaned = stripQuotes(value.trim());
      if (/^https?:\/\//i.test(cleaned)) {
        return cleaned;
      }
    }
  }

  throw new Error(
    'No URL found. Add an input with a url field (any key name works), ' +
    'or set a URLTemplate parameter. The value should start with http:// or https://'
  );
}
