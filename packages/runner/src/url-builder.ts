export function buildUrl(
  parameters: Record<string, unknown>,
  inputData: Record<string, unknown>,
): string {
  const template = parameters.URLTemplate as string | undefined;
  const directUrl = (inputData._url ?? inputData.URL) as string | undefined;

  if (template) {
    return template.replace(/\{(\w+)\}/g, (match, key) => {
      const value = inputData[key] ?? parameters[key];
      return value !== undefined ? String(value) : match;
    });
  }

  if (directUrl) {
    return directUrl;
  }

  throw new Error('No URL: extractor has no URLTemplate parameter and input has no _url field');
}
