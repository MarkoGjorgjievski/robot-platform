/**
 * Split a textarea's raw text into http(s) URLs, one per non-blank line.
 * Each line is trimmed before being checked; blank/whitespace-only lines
 * are skipped entirely (neither valid nor invalid — they carry no intent).
 * Lines that fail `new URL(...)` are reported back verbatim (trimmed) in
 * `invalid`, in the order they appeared, so the caller can show exactly
 * which lines need fixing.
 *
 * http(s) only. `new URL()` happily parses `file:`, `ftp:`, `mailto:` and
 * `javascript:`, and every consumer of this function hands its `urls` to a
 * server procedure validated with `httpUrl` or to a browser that is about to
 * navigate — so a `file:` line used to sail past the counts and Save button
 * and fail the whole batch server-side with a Zod issue naming an array
 * index. Treating it as `invalid` puts it back where the customer can fix
 * it: in the box, named.
 */
export function parseUrlLines(text: string): { urls: string[]; invalid: string[] } {
  const urls: string[] = [];
  const invalid: string[] = [];

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    try {
      const { protocol } = new URL(line);
      if (protocol === 'http:' || protocol === 'https:') urls.push(line);
      else invalid.push(line);
    } catch {
      invalid.push(line);
    }
  }

  return { urls, invalid };
}
