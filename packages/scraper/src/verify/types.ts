export const CUSTOMER_FIELD_TYPES = ['text', 'number', 'money', 'boolean', 'date', 'url', 'image', 'text_list'] as const;
export type CustomerFieldType = (typeof CUSTOMER_FIELD_TYPES)[number];

export type SchemaDefinitionField = {
  key: string;          // stable slug, never changes
  name: string;         // customer label
  type: CustomerFieldType;
  description: string;
  concept: string;      // cache bridge
};

/** A structured path the customer accepted an answer from (spec 2026-09-29 C1). */
export type ConfirmedPath = { source: 'api' | 'json-ld' | 'meta'; path: string };

export type Mark = { xpaths: string[]; text: string; rect: { x: number; y: number; w: number; h: number } };

/** A variant list the customer confirmed on a proof page: the source container and the dot path to the array within it (variant-detect.ts VariantList). */
export type VariantListRef = { source: 'json-ld' | 'api'; path: string };

/** What the customer confirmed about a product's variants on one proof page (spec 2026-10-01 §3). */
export type VariantAnswer = {
  count: number;                     // 0 = "No variants on this product"
  labels: string[];                  // one per variant, as confirmed ("Black/Red · 10C", or the link's label)
  list?: VariantListRef;             // list method: the list the customer confirmed
  links?: string[];                  // links method: the confirmed variant hrefs, absolute
  spot?: {
    index: number;                   // list: which entry was checked (0-based); links: 0
    url?: string;                    // links: the variant page captured for the check
    expected: Record<string, string>;// list: entry-field key → value as confirmed
    paths?: Record<string, string>;  // list: entry-field key → the entry path of an accepted suggestion
    fromProduct?: string[];          // list: entry-field keys the list does not carry
  };
};

export type VerificationSet = {
  urls: string[];                                   // VERIFY_URL_MIN to VERIFY_URL_MAX proof pages
  expected: Record<string, Record<string, string>>; // fieldKey → url → as typed
  listing_url?: string;
  /** fieldKey → url → the element the customer clicked for that cell (spec 2026-09-18 §3.5). Absent on sets written before marks existed. */
  marks?: Record<string, Record<string, Mark>>;
  /** fieldKey → url → the structured path the customer accepted that cell's answer from (spec 2026-09-29 C1). Certified first when it is correct or empty on every checked page; absent on sets written before it existed. */
  paths?: Record<string, Record<string, ConfirmedPath>>;
  /** What the Verification tab shows for each product page: its title and image from the listing. Display only — no hash reads it. */
  cards?: Array<{ url: string; title: string; image?: string }>;
  /** proof url → what the customer confirmed about that product's variants (spec 2026-10-01 §3). Absent on sets written before variants existed. */
  variants?: Record<string, VariantAnswer>;
  /** fieldKey → url → true: the customer said this field is not on that product (spec 2026-10-10 §B1). A checked page where the right answer is "nothing". Absent on sets written before it existed. */
  absent?: Record<string, Record<string, true>>;
  /** fieldKey → the website's default for that field, as typed and trimmed (spec 2026-10-13 §3): a run writes it into every cell the certified paths leave empty; at Verify a blank or default-equal cell is a default cell. Absent on sets written before it existed. */
  defaults?: Record<string, string>;
};

export type Transform = 'identity' | 'cents_to_units' | 'first_of_list' | 'after_label';
export type CertifiedSource = 'api' | 'json-ld' | 'meta' | 'xpath';
/**
 * `provenOn` is set only when a field needed more than one layout (spec 2026-09-17 §3): the proof pages this path was correct on. Absent on a one-layout result, so those stay byte-for-byte what they were. Ignored by extraction and by path identity.
 * `container` (spec 2026-10-20 one-source §3.5) is set on a certified API path only: the name (origin + path) of the response it reads on the proof pages, shared by every API path that reads the same response. Ignored by extraction, by path identity and by the domain store; absent on results certified before it existed.
 */
export type CertifiedPath = { source: CertifiedSource; path: string; transform: Transform; provenOn?: string[]; container?: string };

/** `elsewhere` (spec 2026-10-20 §3.4): the path right on every other page reads nothing here, but another candidate reads the right value on this page — the value is on this product, in another place. */
export type FailReason = 'not_found' | 'different_value' | 'ambiguous' | 'type_mismatch' | 'no_fitting_path' | 'found_unexpected' | 'elsewhere';
export type CellResult =
  /** `path` is absent only on an absent-page pass (spec 2026-10-10 §B2) with zero candidates to name: nothing resolved, so there is nothing to blame the empty result on. */
  | { status: 'pass'; found: string; path?: CertifiedPath }
  | { status: 'fail'; reason: FailReason; found?: string; nearMisses?: string[] }
  | { status: 'not_captured' };

export type FieldVerification = {
  key: string;
  cells: Record<string, CellResult>;   // url → result
  certified: CertifiedPath[];          // ranked, primary first; empty when failed
  weakEvidence: boolean;               // all checked expected values identical
  /** Set (true) only when some certified path is proven on a single page: several nodes can hold the same value on one page, so one page is thinner evidence than three. Never blocks certification. */
  thinEvidence?: boolean;
  /** Set (true) only when the field passed by default only (spec 2026-10-13 §4): every checked page is a default cell and no candidate certified, so `certified` is empty and every product gets the default. Absent otherwise. */
  defaultOnly?: true;
  /** Set (true) only when every checked page is marked "not on this product" and there is no default (spec 2026-10-17 §2): no path, every product left empty. Absent otherwise. */
  notOnWebsite?: true;
  /** Set only when this field's AI proposal threw (spec 2026-10-20 §3.3: a time-out, a malformed answer, no credit, the provider down). The field failed this run; `cells` are its result without the AI, every other field's result stands, and the next Verify is the retry. Absent otherwise. */
  failReason?: 'ai_unavailable';
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
