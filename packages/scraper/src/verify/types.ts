export const CUSTOMER_FIELD_TYPES = ['text', 'number', 'money', 'boolean', 'date', 'url', 'image', 'text_list'] as const;
export type CustomerFieldType = (typeof CUSTOMER_FIELD_TYPES)[number];

export type SchemaDefinitionField = {
  key: string;          // stable slug, never changes
  name: string;         // customer label
  type: CustomerFieldType;
  description: string;
  concept: string;      // cache bridge
};

export type Mark = { xpaths: string[]; text: string; rect: { x: number; y: number; w: number; h: number } };

export type VerificationSet = {
  urls: string[];                                   // VERIFY_URL_MIN to VERIFY_URL_MAX proof pages
  expected: Record<string, Record<string, string>>; // fieldKey → url → as typed
  listing_url?: string;
  /** fieldKey → url → the element the customer clicked for that cell (spec 2026-09-18 §3.5). Absent on sets written before marks existed. */
  marks?: Record<string, Record<string, Mark>>;
  /** What the Verification tab shows for each product page: its title and image from the listing. Display only — no hash reads it. */
  cards?: Array<{ url: string; title: string; image?: string }>;
};

export type Transform = 'identity' | 'cents_to_units' | 'first_of_list';
export type CertifiedSource = 'api' | 'json-ld' | 'meta' | 'xpath';
/** `provenOn` is set only when a field needed more than one layout (spec 2026-09-17 §3): the proof pages this path was correct on. Absent on a one-layout result, so those stay byte-for-byte what they were. Ignored by extraction and by path identity. */
export type CertifiedPath = { source: CertifiedSource; path: string; transform: Transform; provenOn?: string[] };

export type FailReason = 'not_found' | 'different_value' | 'ambiguous' | 'type_mismatch';
export type CellResult =
  | { status: 'pass'; found: string; path: CertifiedPath }
  | { status: 'fail'; reason: FailReason; found?: string; nearMisses?: string[] }
  | { status: 'not_captured' };

export type FieldVerification = {
  key: string;
  cells: Record<string, CellResult>;   // url → result
  certified: CertifiedPath[];          // ranked, primary first; empty when failed
  weakEvidence: boolean;               // all checked expected values identical
  /** Set (true) only when some certified path is proven on a single page: several nodes can hold the same value on one page, so one page is thinner evidence than three. Never blocks certification. */
  thinEvidence?: boolean;
  aiCalled: boolean;
  incomplete: boolean;                 // true when any capture is null
  /** sha256 over this field's definition + the pages + its expected values; a result is current only while it matches (spec 4.4). Absent on rows written before phase 2. */
  fieldHash?: string;
};

export type VerificationOutcome = {
  fields: Record<string, FieldVerification>;
  allPassed: boolean;
  aiCalls: number;
};
