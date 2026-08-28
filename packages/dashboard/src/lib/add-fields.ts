// packages/dashboard/src/lib/add-fields.ts
// Parses the add-fields textarea (Task 11 brief: FieldsTable's "add-fields
// control", and the Gate's "Request more fields") into
// `sources.requestFields`'s input shape. One field per line, `name: hint`
// (FIRST colon splits — a hint may itself contain colons). This UI-facing
// parser is deliberately narrower than the API-side `normalizeUserFields`
// (@robot/scraper's field-normalizer.ts): it documents ONLY the colon form
// (the textarea's placeholder never shows a dash form), so a ` - ` in a line
// is just plain text — part of the hint when it follows a colon, part of an
// invalid name when it doesn't. Never silently drops an invalid line: it
// lands in `rejected`, verbatim, for the caller to show the operator.

export type ParsedField = { name: string; hint?: string };
export type ParseResult = { fields: ParsedField[]; rejected: string[] };

const NAME_RE = /^[a-z0-9_]{1,100}$/;

export function parseAddFields(input: string): ParseResult {
  const fields: ParsedField[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();

  for (const rawLine of input.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue; // blanks dropped, silently

    const colonIdx = line.indexOf(':');
    const namePart = colonIdx === -1 ? line : line.slice(0, colonIdx);
    const hint = colonIdx === -1 ? undefined : line.slice(colonIdx + 1).trim();

    // Validation order per the brief: trim, lowercase, spaces→underscores,
    // THEN check the name shape — a name that only fails because of spacing
    // or case is still accepted; one that fails after normalizing is not.
    const name = namePart.trim().toLowerCase().replace(/ /g, '_');

    if (!NAME_RE.test(name)) {
      rejected.push(line);
      continue;
    }
    if (seen.has(name)) continue; // dupes dropped, silently, keeping the first
    seen.add(name);

    fields.push(hint ? { name, hint } : { name });
  }

  return { fields, rejected };
}
