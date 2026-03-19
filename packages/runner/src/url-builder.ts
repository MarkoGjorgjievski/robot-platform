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
    return directUrl;
  }

  // Fallback: find any input value that looks like a URL
  for (const value of Object.values(inputData)) {
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) {
      return value;
    }
  }

  throw new Error(
    'No URL found. Provide a URLTemplate parameter, or an input field named url/_url/URL, ' +
    'or any input value starting with http(s)://'
  );
}
