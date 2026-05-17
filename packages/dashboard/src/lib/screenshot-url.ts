import { API_URL } from './api-url';

/**
 * Compose a screenshot URL from a relative or absolute path.
 * Passes through absolute (`http://...`) paths.
 * Ensures a leading `/` for relative paths before prepending API_URL.
 */
export function screenshotUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const withSlash = path.startsWith('/') ? path : `/${path}`;
  return `${API_URL}${withSlash}`;
}
