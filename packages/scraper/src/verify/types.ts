export const CUSTOMER_FIELD_TYPES = ['text', 'number', 'money', 'boolean', 'date', 'url', 'image', 'text_list'] as const;
export type CustomerFieldType = (typeof CUSTOMER_FIELD_TYPES)[number];

export type SchemaDefinitionField = {
  key: string;          // stable slug, never changes
  name: string;         // customer label
  type: CustomerFieldType;
  description: string;
  concept: string;      // cache bridge
};

export type VerificationSet = {
  urls: string[];                                   // exactly VERIFY_URL_COUNT
  expected: Record<string, Record<string, string>>; // fieldKey → url → as typed
  listing_url?: string;
};

export type Transform = 'identity' | 'cents_to_units' | 'first_of_list';
export type CertifiedSource = 'api' | 'json-ld' | 'meta' | 'xpath';
export type CertifiedPath = { source: CertifiedSource; path: string; transform: Transform };

export type FailReason = 'not_found' | 'different_value' | 'ambiguous' | 'type_mismatch';
export type CellResult =
  | { status: 'pass'; found: string; path: CertifiedPath }
  | { status: 'fail'; reason: FailReason; found?: string; nearMisses?: string[] }
  | { status: 'not_captured' };

export type FieldVerification = {
  key: string;
  cells: Record<string, CellResult>;   // url → result
  certified: CertifiedPath[];          // ranked, primary first; empty when failed
  weakEvidence: boolean;               // all three expected values identical
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
