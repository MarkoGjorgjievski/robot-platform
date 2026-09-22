/** The Fields screen's view logic (spec 2026-09-21 §5; the contract, spec 2026-09-08 §4.1–4.3). Pure. */

/**
 * The engine's customer-facing field types, declared here rather than imported:
 * `CUSTOMER_FIELD_TYPES` is a value in `@robot/scraper`, whose module graph
 * reaches Playwright, the database and the Anthropic SDK — none of which may
 * enter a browser bundle. `fields-view.test.ts` imports the real list and
 * asserts the two are identical, so this copy cannot drift in silence.
 */
export const FIELD_TYPES = ['text', 'number', 'money', 'boolean', 'date', 'url', 'image', 'text_list'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** Customer words for the engine's types. */
export const TYPE_LABELS: Record<FieldType, string> = {
  text: 'Text',
  number: 'Number',
  money: 'Money',
  boolean: 'Yes / no',
  date: 'Date',
  url: 'Link',
  image: 'Image',
  text_list: 'List',
};

export type ContractRow = { key: string; name: string; type: FieldType; concept: string; description?: string };
export type FieldStatusRow = {
  verified: number;
  total: number;
  websites: Array<{ sourceId: string; slug: string; name: string; verified: boolean }>;
};
export type FieldView = {
  key: string;
  name: string;
  type: FieldType;
  typeLabel: string;
  verifiedLabel: string;
  retypeLocked: boolean;
  verifiedOn: string[];
};

export function fieldsView(
  contract: readonly ContractRow[],
  status: Record<string, FieldStatusRow> | undefined,
  websiteCount: number,
): FieldView[] {
  return contract.map((f) => {
    const s = status?.[f.key];
    const verifiedOn = s ? s.websites.filter((w) => w.verified).map((w) => w.name) : [];
    const verified = s?.verified ?? 0;
    return {
      key: f.key,
      name: f.name,
      type: f.type,
      typeLabel: TYPE_LABELS[f.type],
      verifiedLabel: websiteCount === 0 ? '—' : verified === 0 ? 'Not yet' : `${verified} of ${websiteCount} websites`,
      // A verified field cannot change type (the API refuses); before status loads nothing is locked, and the API is the backstop.
      retypeLocked: verified > 0,
      verifiedOn,
    };
  });
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function sharedNote(websiteCount: number): string | null {
  return websiteCount > 1 ? `Shared with ${plural(websiteCount, 'website')}` : null;
}

export function addNote(websiteCount: number): string | null {
  return websiteCount > 1 ? `This adds the field to ${plural(websiteCount, 'website')}` : null;
}

/**
 * The refusals a customer caused by typing a name, in their own words — or null
 * when the failure is not theirs to fix, which the caller reports without
 * naming a cause. Both come from `assertNameFree` in the datasets router, as
 * `BAD_REQUEST`: it refuses a duplicate name (case-insensitively) and the one
 * name the engine keeps for itself.
 */
export function nameRefusal(error: unknown, name: string): string | null {
  const e = error as { data?: { code?: string }; message?: string } | undefined;
  if (e?.data?.code !== 'BAD_REQUEST') return null;
  if (e.message?.includes('already exists')) return `There is already a field called ${name}.`;
  if (e.message?.includes('is reserved')) return `${name} is a name we use ourselves. Pick another.`;
  return null;
}

export function deleteNote(view: FieldView, websiteCount: number): string {
  if (websiteCount === 0) return 'Removes the field.';
  const verified = view.verifiedOn.length;
  return verified > 0
    ? `Removes it from ${plural(websiteCount, 'website')}; ${verified} of them had verified it.`
    : `Removes it from ${plural(websiteCount, 'website')}.`;
}
