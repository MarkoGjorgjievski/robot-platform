/**
 * What to show under the sign-in form. Pure, so it can be tested without a
 * browser.
 *
 * The api-server installs no tRPC `errorFormatter`, so a Zod failure arrives as
 * a message that is literally a JSON array of issues. Printing that at a person
 * is not an option; and a dead api-server arrives as the browser's bare "Failed
 * to fetch", which says nothing about what to do.
 */
export function signInErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');

  const issues = parseZodIssues(raw);
  if (issues) {
    const fields = new Set(issues.map((i) => String(i.path?.[0] ?? '')));
    if (fields.has('email')) return 'Enter a valid email address.';
    if (fields.has('password')) return 'Enter your password.';
    return 'Check the details you entered.';
  }

  if (/failed to fetch|networkerror|load failed/i.test(raw)) {
    return 'Cannot reach the server. Check that the api-server is running.';
  }

  return raw || 'Could not sign in.';
}

function parseZodIssues(raw: string): Array<{ path?: unknown[] }> | null {
  if (!raw.trimStart().startsWith('[')) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((i) => typeof i === 'object' && i !== null)) {
      return parsed as Array<{ path?: unknown[] }>;
    }
  } catch {
    // Not JSON after all — fall through to the raw message.
  }
  return null;
}
