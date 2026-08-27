/**
 * Split a textarea's raw text into URLs, one per non-blank line.
 * Each line is trimmed before being checked; blank/whitespace-only lines
 * are skipped entirely (neither valid nor invalid — they carry no intent).
 * Lines that fail `new URL(...)` are reported back verbatim (trimmed) in
 * `invalid`, in the order they appeared, so the caller can show exactly
 * which lines need fixing.
 */
export function parseUrlLines(text: string): { urls: string[]; invalid: string[] } {
  const urls: string[] = [];
  const invalid: string[] = [];

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    try {
      new URL(line);
      urls.push(line);
    } catch {
      invalid.push(line);
    }
  }

  return { urls, invalid };
}
