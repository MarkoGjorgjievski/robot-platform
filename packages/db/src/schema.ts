import { pgTable, text, timestamp, boolean, integer, jsonb, uuid, varchar, index, uniqueIndex, check, numeric, customType } from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

/** Postgres `bytea` (drizzle-orm 0.44 has no built-in one): a Buffer in and out (postgres-js). */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

// ─── Organizations ───────────────────────────────────────────────────────────

export const orgs = pgTable('orgs', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }).notNull().unique(),
  description: text('description'),
  // True for the auto-created personal org every user gets; false for a shared org.
  personal: boolean('personal').notNull().default(false),
  // Set for a personal org (its one owner); null for a shared org. Set null if that user is removed.
  ownerUserId: uuid('owner_user_id').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  // Metering (spec 2026-10-24 metering §2.2): this org's monthly AI limit in USD. Null: the default
  // (`ORG_AI_CAP_USD`, $25 unless set; `none` = no default). Staff set it (`orgs.setAiCap`); a customer never reads it.
  aiCapUsd: numeric('ai_cap_usd', { precision: 10, scale: 2 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check('orgs_ai_cap_usd_nonnegative', sql`${table.aiCapUsd} >= 0`),
]);

export const orgsRelations = relations(orgs, ({ many }) => ({
  extractors: many(extractors),
  projects: many(projects),
  memberships: many(memberships),
}));

// ─── Identity (spec 2026-09-21 §2) ──────────────────────────────────────────
// A user belongs to orgs through memberships; a session names the user and
// the org they are currently working in. Sign-in is a stub for now (any
// password), so there is no password column: the tables are shaped for real
// auth later, not for this one.

export const MEMBERSHIP_ROLES = ['owner', 'admin', 'member'] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];
export const USER_THEMES = ['dark', 'light', 'system'] as const;
export type UserTheme = (typeof USER_THEMES)[number];

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  avatarColour: varchar('avatar_colour', { length: 7 }).notNull(),
  theme: varchar('theme', { length: 10 }).notNull().default('dark'),
  // Email (spec 2026-10-24 email §3.3): which notification emails this person gets as an owner or admin.
  // Account messages (staff access, a role change, a removal) are always sent.
  emailAttention: boolean('email_attention').notNull().default(true),
  emailFailedRuns: boolean('email_failed_runs').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const memberships = pgTable('memberships', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 10 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('memberships_user_org_idx').on(table.userId, table.orgId),
  index('memberships_org_id_idx').on(table.orgId),
]);

export const sessions = pgTable('sessions', {
  token: varchar('token', { length: 64 }).primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  // Staff access (spec 2026-10-07 §2.1): while set and valid, the session works inside this customer org.
  staffOrgId: uuid('staff_org_id').references(() => orgs.id, { onDelete: 'set null' }),
  staffEnteredAt: timestamp('staff_entered_at', { withTimezone: true }),
}, (table) => [index('sessions_user_id_idx').on(table.userId)]);

export const usersRelations = relations(users, ({ many }) => ({ memberships: many(memberships), sessions: many(sessions) }));
export const membershipsRelations = relations(memberships, ({ one }) => ({
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
  org: one(orgs, { fields: [memberships.orgId], references: [orgs.id] }),
}));
export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
  org: one(orgs, { fields: [sessions.orgId], references: [orgs.id] }),
}));

// ─── Projects ───────────────────────────────────────────────────────────────

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }).notNull(),
  description: text('description'),
  // ─── Inherited config (Phase 0) ─────────────────────────────────────────────
  // Sources in this project inherit these unless they override.
  defaultSchedule: varchar('default_schedule', { length: 100 }),
  outputDestination: text('output_destination'),
  proxyPool: varchar('proxy_pool', { length: 100 }),
  defaultRateLimit: integer('default_rate_limit'),
  notificationChannel: text('notification_channel'),
  ownerEmail: varchar('owner_email', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('projects_org_id_idx').on(table.orgId),
  uniqueIndex('projects_org_slug_idx').on(table.orgId, table.slug),
]);

export const projectsRelations = relations(projects, ({ one, many }) => ({
  org: one(orgs, { fields: [projects.orgId], references: [orgs.id] }),
  datasets: many(datasets),
  inputSets: many(inputSets),
}));

// ─── Datasets ────────────────────────────────────────────────────────────────

export const datasets = pgTable('datasets', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }).notNull(),
  description: text('description'),
  schema: jsonb('schema'),
  // Variants setting (spec 2026-10-01 §2): 'ignore' | 'row_per_variant' | 'nested'.
  // Defaults to 'ignore' for every project, existing and new.
  variantMode: varchar('variant_mode', { length: 20 }).notNull().default('ignore'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('datasets_project_id_idx').on(table.projectId),
  uniqueIndex('datasets_project_slug_idx').on(table.projectId, table.slug),
]);

export const datasetsRelations = relations(datasets, ({ one, many }) => ({
  project: one(projects, { fields: [datasets.projectId], references: [projects.id] }),
  sources: many(sources),
}));

// ─── Sources (new extractors) ───────────────────────────────────────────────

export const sources = pgTable('sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  datasetId: uuid('dataset_id').references(() => datasets.id, { onDelete: 'cascade' }),
  domainId: uuid('domain_id').references(() => domains.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  slug: varchar('slug', { length: 255 }).notNull(),
  // Proxy support (spec 2026-10-24 proxy §2.1): the market the website is read from — an ISO 3166-1 alpha-2 code from
  // @robot/browser's COUNTRIES (lower-case), or null (no preference: en-US / New York, as before). Staff set it.
  country: varchar('country', { length: 2 }),
  locale: varchar('locale', { length: 10 }),
  currency: varchar('currency', { length: 10 }),
  dataCenter: varchar('data_center', { length: 10 }),
  proxyType: varchar('proxy_type', { length: 50 }),
  loginPool: varchar('login_pool', { length: 100 }),
  maximumInputs: integer('maximum_inputs'),
  runnerFramework: varchar('runner_framework', { length: 50 }),
  schemaValues: jsonb('schema_values').notNull().default({}),
  robotTemplate: varchar('robot_template', { length: 255 }).notNull().default('robots/san-antonio'),
  variant: varchar('variant', { length: 50 }).notNull().default('default'),
  parameters: jsonb('parameters').notNull().default({}),
  isActive: boolean('is_active').default(true).notNull(),
  // AI scraper fields
  sourceType: varchar('source_type', { length: 20 }).default('legacy'),
  urlPattern: text('url_pattern'),
  selectorsJson: jsonb('selectors_json'),
  // ─── New extraction model fields (Phase 0) ─────────────────────────────────
  // 'direct' | 'template' | 'category' | 'search' | 'sitemap'
  inputStrategy: varchar('input_strategy', { length: 20 }),
  urlTemplate: text('url_template'),
  // 'detail' | 'listing' | 'listing_to_detail' — null until set
  listingMode: varchar('listing_mode', { length: 20 }),
  budget: jsonb('budget').notNull().default({}),
  isSandbox: boolean('is_sandbox').notNull().default(false),
  // Set when a human confirmed this source's probe run looked right (spec §3).
  // Null = unconfirmed: the first Extract probes the first input and gates.
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  inputSetId: uuid('input_set_id').references(() => inputSets.id, { onDelete: 'set null' }),
  aiStatus: varchar('ai_status', { length: 20 }).default('pending'),
  // Fields a repair run asked this source to backfill: Array<{name, hint?}>.
  requestedFields: jsonb('requested_fields'),
  // Customer-defined schema (spec §3.1): Array<{ key, name, type, description, concept }>.
  schemaDefinition: jsonb('schema_definition'),
  // The three verification URLs + expected values as typed (spec §3.2).
  verificationSet: jsonb('verification_set'),
  // Field keys flagged by the last run's drift check (spec §5.3): string[].
  driftedFields: jsonb('drifted_fields'),
  // How this website exposes variants, chosen on the Variants step (spec
  // 2026-10-01 §3): VariantSetup { method: 'list' | 'links' | 'none'; axes:
  // Array<{ from: string; axisKey: string }>; confirmedAt }. Null until set.
  variantSetup: jsonb('variant_setup'),
  // When the scheduled website check (spec 2026-10-21 §3.3) may next read this
  // website's proof pages. Null = due. Moved on by every claim, every completed
  // Verify and every finished check.
  nextCheckAt: timestamp('next_check_at', { withTimezone: true }),
  // Recurring extraction (spec 2026-10-24 §3.1): { days: number[] (ISO, 1 = Monday); time: 'HH:MM'; timeZone }
  // or null (no schedule). `next_run_at`: when the worker's sweep next starts a run (null: never);
  // `schedule_last`: the last sweep's outcome { at, outcome: 'started' | 'skipped', reason?, runId? }.
  schedule: jsonb('schedule'),
  nextRunAt: timestamp('next_run_at', { withTimezone: true }),
  scheduleLast: jsonb('schedule_last'),
  // Where a finished run is posted (§3.4), and the secret that signs the post and its file links
  // (32 random bytes, hex; made on the first save, kept when the address is removed).
  webhookUrl: text('webhook_url'),
  webhookSecret: text('webhook_secret'),
  // Proxy support (spec 2026-10-24 proxy §2.1): http://, https:// or socks5://, optionally user:pass@, `{country}` filled
  // in at use. Null: DEFAULT_PROXY_URL when set, else direct. The password is plain text, like the webhook secret; it is
  // never logged (`redactProxy`) and never reaches a customer. Staff set it (`sources.update`, operators only).
  proxyUrl: text('proxy_url'),
  // When a website turns us away (spec 2026-10-28 turned away §3.3): set when a try through FALLBACK_PROXY_URL read
  // the page after the direct route was walled. While set (and FALLBACK_PROXY_URL is), the website loads through the
  // fallback proxy unless it has its own address or DEFAULT_PROXY_URL is set. A preference, not an address; staff
  // clear it ("Go direct again").
  fallbackProxyAt: timestamp('fallback_proxy_at', { withTimezone: true }),
  // Email (spec 2026-10-24 email §3.2): when this website turned to "Needs attention" — null while it does not need
  // it. `syncAttention` claims the off → on turn with `WHERE attention_since IS NULL`, so one writer sends.
  attentionSince: timestamp('attention_since', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('sources_dataset_id_idx').on(table.datasetId),
  index('sources_domain_id_idx').on(table.domainId),
  uniqueIndex('sources_dataset_slug_idx').on(table.datasetId, table.slug),
  index('sources_input_set_id_idx').on(table.inputSetId),
  index('sources_is_sandbox_idx').on(table.isSandbox),
  index('sources_next_run_at_idx').on(table.nextRunAt).where(sql`${table.schedule} IS NOT NULL`),
  check('sources_non_sandbox_requires_dataset', sql`${table.isSandbox} = true OR ${table.datasetId} IS NOT NULL`),
]);

export const sourcesRelations = relations(sources, ({ one, many }) => ({
  dataset: one(datasets, { fields: [sources.datasetId], references: [datasets.id] }),
  domain: one(domains, { fields: [sources.domainId], references: [domains.id] }),
  runs: many(runs),
  captures: many(captures),
  extractions: many(extractions),
  inputSet: one(inputSets, { fields: [sources.inputSetId], references: [inputSets.id] }),
  verifications: many(sourceVerifications),
}));

// ─── Input Sets ──────────────────────────────────────────────────────────────

export const inputSets = pgTable('input_sets', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  // 'direct' | 'template' | 'category' | 'search' | 'sitemap' | 'inline'
  // 'inline' is reserved for Sandbox Sources (one hidden InputSet per Sandbox Source)
  type: varchar('type', { length: 20 }).notNull(),
  name: text('name').notNull(),
  // Column definitions: [{ name, primary, type, propagate? }]
  columns: jsonb('columns').notNull().default([]),
  // Rows of values, each row keyed by column name
  rows: jsonb('rows').notNull().default([]),
  // True for the hidden inline InputSet attached to a single Sandbox Source
  isInline: boolean('is_inline').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('input_sets_project_id_idx').on(table.projectId),
]);

export const inputSetsRelations = relations(inputSets, ({ one, many }) => ({
  project: one(projects, { fields: [inputSets.projectId], references: [projects.id] }),
  sources: many(sources),
}));

// ─── Domains ─────────────────────────────────────────────────────────────────

export const domains = pgTable('domains', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  prefix: varchar('prefix', { length: 10 }),
  hasGotoOverride: boolean('has_goto_override').default(false).notNull(),
  hasSetZipCodeOverride: boolean('has_set_zip_code_override').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const domainsRelations = relations(domains, ({ many }) => ({
  extractors: many(extractors),
  robotOverrides: many(robotOverrides),
}));

// ─── Extractors ──────────────────────────────────────────────────────────────

export const extractors = pgTable('extractors', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  domainId: uuid('domain_id').notNull().references(() => domains.id, { onDelete: 'cascade' }),
  country: varchar('country', { length: 10 }).notNull(),
  robotTemplate: varchar('robot_template', { length: 255 }).notNull().default('robots/san-antonio'),
  variant: varchar('variant', { length: 50 }).notNull(),
  parameters: jsonb('parameters').notNull().default({}),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('extractors_org_id_idx').on(table.orgId),
  index('extractors_domain_id_idx').on(table.domainId),
  uniqueIndex('extractors_org_domain_country_variant_idx').on(table.orgId, table.domainId, table.country, table.variant),
]);

export const extractorsRelations = relations(extractors, ({ one, many }) => ({
  org: one(orgs, { fields: [extractors.orgId], references: [orgs.id] }),
  domain: one(domains, { fields: [extractors.domainId], references: [domains.id] }),
  inputs: many(extractorInputs),
  credentials: many(credentials),
  runs: many(runs),
}));

// ─── Extractor Inputs ────────────────────────────────────────────────────────

export const extractorInputs = pgTable('extractor_inputs', {
  id: uuid('id').primaryKey().defaultRandom(),
  extractorId: uuid('extractor_id').notNull().references(() => extractors.id, { onDelete: 'cascade' }),
  label: varchar('label', { length: 255 }).notNull(),
  inputData: jsonb('input_data').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('extractor_inputs_extractor_id_idx').on(table.extractorId),
]);

export const extractorInputsRelations = relations(extractorInputs, ({ one }) => ({
  extractor: one(extractors, { fields: [extractorInputs.extractorId], references: [extractors.id] }),
}));

// ─── Credentials ─────────────────────────────────────────────────────────────

export const credentials = pgTable('credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  extractorId: uuid('extractor_id').notNull().references(() => extractors.id, { onDelete: 'cascade' }),
  environment: varchar('environment', { length: 50 }).notNull().default('default'),
  username: text('username'),
  password: text('password'),
  extraFields: jsonb('extra_fields'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('credentials_extractor_id_idx').on(table.extractorId),
  uniqueIndex('credentials_extractor_env_idx').on(table.extractorId, table.environment),
]);

export const credentialsRelations = relations(credentials, ({ one }) => ({
  extractor: one(extractors, { fields: [credentials.extractorId], references: [extractors.id] }),
}));

// ─── Robot Overrides ─────────────────────────────────────────────────────────

export const robotOverrides = pgTable('robot_overrides', {
  id: uuid('id').primaryKey().defaultRandom(),
  domainId: uuid('domain_id').notNull().references(() => domains.id, { onDelete: 'cascade' }),
  country: varchar('country', { length: 10 }),
  robotTemplate: varchar('robot_template', { length: 255 }).notNull().default('robots/san-antonio'),
  parameterOverrides: jsonb('parameter_overrides').default({}),
  hasGoto2: boolean('has_goto2').default(false).notNull(),
  hasBeforeExtract: boolean('has_before_extract').default(false).notNull(),
  hasExtract: boolean('has_extract').default(false).notNull(),
  hasTransform: boolean('has_transform').default(false).notNull(),
  schemas: jsonb('schemas'),
  jsOverrides: jsonb('js_overrides'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('robot_overrides_domain_id_idx').on(table.domainId),
]);

export const robotOverridesRelations = relations(robotOverrides, ({ one }) => ({
  domain: one(domains, { fields: [robotOverrides.domainId], references: [domains.id] }),
}));

// ─── Domain Intelligence (Site Cache) ────────────────────────────────────────

export const domainIntelligence = pgTable('domain_intelligence', {
  id: uuid('id').primaryKey().defaultRandom(),
  domain: varchar('domain', { length: 255 }).notNull(),
  pageType: varchar('page_type', { length: 50 }).notNull(),
  // API endpoint patterns discovered
  apiEndpoints: jsonb('api_endpoints').default([]),
  // Resilient field extraction — multiple ranked paths per field
  fieldPaths: jsonb('field_paths').default({}),
  // Popup/consent selectors that worked on this domain
  popupSelectors: jsonb('popup_selectors').default([]),
  // Pagination detection results for listing pages
  paginationConfig: jsonb('pagination_config'),
  // Human-pinned row container selector (click-to-select backend); null = AI-generated each run
  rowSelector: jsonb('row_selector'),
  // What this domain CAN yield per concept — labelled candidates, discovered
  // once per domain by the v2.5 labelling pass. Never serves values.
  candidateCatalogue: jsonb('candidate_catalogue').default({}).notNull(),
  // Structured data availability
  hasJsonLd: boolean('has_json_ld').default(false).notNull(),
  hasNextData: boolean('has_next_data').default(false).notNull(),
  // Extraction stats
  totalRuns: integer('total_runs').default(0).notNull(),
  successfulRuns: integer('successful_runs').default(0).notNull(),
  consecutiveFailures: integer('consecutive_failures').default(0).notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }).defaultNow().notNull(),
  lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('domain_intelligence_domain_idx').on(table.domain),
  uniqueIndex('domain_intelligence_domain_page_type_idx').on(table.domain, table.pageType),
]);

// ─── Captures (AI Scraper) ──────────────────────────────────────────────────

export const captures = pgTable('captures', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: uuid('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }),
  runId: uuid('run_id').references(() => runs.id, { onDelete: 'set null' }),
  url: text('url').notNull(),
  html: text('html'),
  markdown: text('markdown'),
  screenshotPath: text('screenshot_path'),
  metadata: jsonb('metadata').default({}),
  // The job working on this row (spec 2026-10-23 §4.5); null for rows written outside the queue.
  jobId: uuid('job_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('captures_source_id_idx').on(table.sourceId),
  index('captures_run_id_idx').on(table.runId),
  index('captures_job_id_idx').on(table.jobId),
]);

export const capturesRelations = relations(captures, ({ one, many }) => ({
  source: one(sources, { fields: [captures.sourceId], references: [sources.id] }),
  extractions: many(extractions),
  run: one(runs, { fields: [captures.runId], references: [runs.id] }),
}));

// ─── Source verifications (customer schema verification) ────────────────────
// One row per Verify click. `completed_at` is the terminal marker.

export const sourceVerifications = pgTable('source_verifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: uuid('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  // sha256 of the schema_definition + verification_set this run verified; a
  // certification is current only while the Source's hash still matches.
  definitionHash: varchar('definition_hash', { length: 64 }).notNull(),
  // Record<url, { captureId: string; capturedAt: string; screenshotUrl?: string; blockedReason?: string }>
  captures: jsonb('captures').notNull().default({}),
  // Record<fieldKey, FieldVerification> — see @robot/scraper verify/types.ts
  results: jsonb('results').notNull().default({}),
  // VariantVerification (@robot/scraper verify/variant-certify.ts) — the free variant check run
  // alongside this Verify, when the website's project wants variants (spec 2026-10-01 §4). Null
  // for a website with variants off, or a verification row written before this existed.
  variantResults: jsonb('variant_results'),
  // JevAgreement (@robot/api verify/jev-reading.ts): per proof page, Jev's picks against what the
  // customer verified (spec 2026-10-16 §7). Null when no reading was done for its pages.
  verifyAgreement: jsonb('verify_agreement'),
  allPassed: boolean('all_passed').notNull().default(false),
  aiCalls: integer('ai_calls').notNull().default(0),
  costUsd: numeric('cost_usd', { precision: 10, scale: 4 }).notNull().default('0'),
  errorMessage: text('error_message'),
  // The job working on this row (spec 2026-10-23 §4.5); null for rows written outside the queue.
  jobId: uuid('job_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('source_verifications_source_id_idx').on(table.sourceId),
  index('source_verifications_source_completed_idx').on(table.sourceId, table.completedAt),
  index('source_verifications_job_id_idx').on(table.jobId),
]);

export const sourceVerificationsRelations = relations(sourceVerifications, ({ one }) => ({
  source: one(sources, { fields: [sourceVerifications.sourceId], references: [sources.id] }),
}));

// ─── Drift Checks (2026-10-05) ──────────────────────────────────────────────
// Free, automatic (after a run flags drift) or on-demand recheck of a drifted
// field's proof pages: what happened to it (other-layout / moved / changed /
// lost), per @robot/scraper verify/drift-classify.ts. Never writes
// certification itself — only this row and the proof-page captures it takes
// (plan 2026-10-05-drift-repair, Global Constraints).

export const driftChecks = pgTable('drift_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: uuid('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }),
  runId: uuid('run_id').references(() => runs.id, { onDelete: 'set null' }),
  // 'running' | 'done' | 'failed'
  status: varchar('status', { length: 12 }).notNull().default('running'),
  // 'run' | 'manual' | 'verify' | 'schedule' (spec 2026-10-21 §3.3): what started the check.
  trigger: varchar('trigger', { length: 12 }).notNull().default('run'),
  // DriftCheckResults (@robot/scraper verify/drift-classify.ts)
  results: jsonb('results'),
  error: text('error'),
  // The job working on this row (spec 2026-10-23 §4.5); null for rows written outside the queue.
  jobId: uuid('job_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => [
  index('drift_checks_source_id_idx').on(table.sourceId),
  index('drift_checks_job_id_idx').on(table.jobId),
]);

export const driftChecksRelations = relations(driftChecks, ({ one }) => ({
  source: one(sources, { fields: [driftChecks.sourceId], references: [sources.id] }),
  run: one(runs, { fields: [driftChecks.runId], references: [runs.id] }),
}));

// ─── Coverage Checks (2026-10-10) ───────────────────────────────────────────
// The coverage check (spec 2026-10-10 §A): after a passing Verify, twenty
// products sampled from the listing and read with the certified paths only,
// so the Verification tab can say where a field comes back empty before the
// first run. Writes only this row: no captures, no verification set, no path
// stats, no domain cache (spec A4).

export const coverageChecks = pgTable('coverage_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: uuid('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }),
  verificationId: uuid('verification_id').references(() => sourceVerifications.id, { onDelete: 'set null' }),
  // 'running' | 'done' | 'failed'
  status: varchar('status', { length: 12 }).notNull().default('running'),
  // CoverageResults (@robot/api verify/run-coverage-check.ts)
  results: jsonb('results'),
  error: text('error'),
  // The job working on this row (spec 2026-10-23 §4.5); null for rows written outside the queue.
  jobId: uuid('job_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => [
  index('coverage_checks_source_id_idx').on(table.sourceId),
  index('coverage_checks_job_id_idx').on(table.jobId),
]);

export const coverageChecksRelations = relations(coverageChecks, ({ one }) => ({
  source: one(sources, { fields: [coverageChecks.sourceId], references: [sources.id] }),
  verification: one(sourceVerifications, { fields: [coverageChecks.verificationId], references: [sourceVerifications.id] }),
}));

// ─── Jobs (2026-10-23) ──────────────────────────────────────────────────────
// The work queue every page load goes through (spec 2026-10-23 capture worker §4.1). The api-server
// enqueues in the transaction that writes the status row; @robot/worker claims with FOR UPDATE SKIP
// LOCKED and holds a lease it renews. `queue` namespaces workers: tests and the isolated smoke pair use
// their own. A status row names its job in `job_id` (no foreign key: finished jobs are purged).
export const jobs = pgTable('jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  queue: varchar('queue', { length: 64 }).notNull().default('default'),
  type: varchar('type', { length: 40 }).notNull(),
  // One queued or running job per (queue, key); null never collides.
  key: varchar('key', { length: 200 }),
  payload: jsonb('payload').notNull().default({}),
  // 'queued' | 'running' | 'done' | 'failed'
  status: varchar('status', { length: 12 }).notNull().default('queued'),
  // Lower runs first.
  priority: integer('priority').notNull().default(10),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(1),
  runAfter: timestamp('run_after', { withTimezone: true }).defaultNow().notNull(),
  // Not started by then: failed 'expired' and its rows closed.
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  lockedBy: varchar('locked_by', { length: 200 }),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  // Monitoring (spec 2026-10-25 §2.3): the last sign of life outside the worker's memory — set by a claim (= started_at)
  // and by ctx.progress() at most every 15 s. The watchdog and ops' Queue read it ("silent": older than half stuckMs).
  progressAt: timestamp('progress_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  // Done: `{ value }`; failed: `{ error: SerializedError }` (@robot/api jobs/errors.ts).
  result: jsonb('result'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('jobs_claim_idx').on(table.queue, table.status, table.priority, table.runAfter),
  index('jobs_lease_idx').on(table.status, table.lockedUntil),
  uniqueIndex('jobs_active_key_idx').on(table.queue, table.key)
    .where(sql`${table.status} in ('queued', 'running') and ${table.key} is not null`),
]);

// ─── Workers (2026-10-25) ───────────────────────────────────────────────────
// One row per running worker (spec 2026-10-25 monitoring §2.1): upserted every 30 s, deleted on a clean stop. A beat
// older than 2 minutes is a dead worker; rows older than a day are purged by any worker. `id` is the runner's worker
// id (`host:pid:rand`) — a job's `locked_by` is that id, '#', and a claim token.
export const workers = pgTable('workers', {
  id: varchar('id', { length: 200 }).primaryKey(),
  queue: varchar('queue', { length: 64 }).notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  beatAt: timestamp('beat_at', { withTimezone: true }).defaultNow().notNull(),
  // The git sha if known, else the package version.
  version: varchar('version', { length: 64 }),
  // { inUse, max }
  browsers: jsonb('browsers').notNull().default({}),
  // Running jobs per lane: { interactive, background, runs }
  lanes: jsonb('lanes').notNull().default({}),
  websiteChecks: boolean('website_checks').notNull().default(false),
  recurringRuns: boolean('recurring_runs').notNull().default(false),
}, (table) => [
  index('workers_queue_beat_idx').on(table.queue, table.beatAt),
]);

// ─── Field holds and value refreshes (2026-10-21) ───────────────────────────
// Websites change (spec 2026-10-21 §3.1–§3.2): a hold keeps a field's last
// passing result after a Verify that did not pass it, so runs go on with the
// last good paths while they still extract; a value refresh records one
// automatic update of a by-nature field's expected values.

export const fieldHolds = pgTable('field_holds', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: uuid('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }),
  fieldKey: varchar('field_key', { length: 255 }).notNull(),
  // FieldVerification (@robot/scraper verify/types.ts): the last passing result; runs read its `certified`.
  result: jsonb('result').notNull(),
  // The completed Verify that passed it, and when.
  verificationId: uuid('verification_id').references(() => sourceVerifications.id, { onDelete: 'set null' }),
  verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull(),
  // The Verify that did not pass it; null when an automatic refresh made the hold.
  failedVerificationId: uuid('failed_verification_id').references(() => sourceVerifications.id, { onDelete: 'set null' }),
  // string[]: every field hash this hold stands for (the hash it passed at, plus each refresh's).
  fieldHashes: jsonb('field_hashes').notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('field_holds_source_field_idx').on(table.sourceId, table.fieldKey),
]);

export const fieldHoldsRelations = relations(fieldHolds, ({ one }) => ({
  source: one(sources, { fields: [fieldHolds.sourceId], references: [sources.id] }),
  verification: one(sourceVerifications, { fields: [fieldHolds.verificationId], references: [sourceVerifications.id] }),
  failedVerification: one(sourceVerifications, { fields: [fieldHolds.failedVerificationId], references: [sourceVerifications.id] }),
}));

export const valueRefreshes = pgTable('value_refreshes', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: uuid('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }),
  fieldKey: varchar('field_key', { length: 255 }).notNull(),
  at: timestamp('at', { withTimezone: true }).defaultNow().notNull(),
  driftCheckId: uuid('drift_check_id').references(() => driftChecks.id, { onDelete: 'set null' }),
  // The free re-verify the refresh started; null when none could start.
  verificationId: uuid('verification_id').references(() => sourceVerifications.id, { onDelete: 'set null' }),
  // Record<url, { was: string; now: string; path: CertifiedPath }>
  pages: jsonb('pages').notNull(),
  fromHash: varchar('from_hash', { length: 64 }).notNull(),
  toHash: varchar('to_hash', { length: 64 }).notNull(),
}, (table) => [
  index('value_refreshes_source_at_idx').on(table.sourceId, table.at),
]);

export const valueRefreshesRelations = relations(valueRefreshes, ({ one }) => ({
  source: one(sources, { fields: [valueRefreshes.sourceId], references: [sources.id] }),
  driftCheck: one(driftChecks, { fields: [valueRefreshes.driftCheckId], references: [driftChecks.id] }),
  verification: one(sourceVerifications, { fields: [valueRefreshes.verificationId], references: [sourceVerifications.id] }),
}));

// ─── Jev readings (2026-10-16) ──────────────────────────────────────────────
// Jev at Verify, in shadow (spec 2026-10-16): one reading per proof-page
// capture — which candidate each ambiguous field is, which variant the page
// shows. Shown and measured, never applied.

export const jevReadings = pgTable('jev_readings', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: uuid('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }),
  captureId: uuid('capture_id').notNull().references(() => captures.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  // 'running' | 'done' | 'failed'
  status: varchar('status', { length: 12 }).notNull().default('running'),
  model: varchar('model', { length: 40 }),
  // JevAnswers (@robot/api verify/jev-reading.ts)
  answers: jsonb('answers'),
  inputTokens: integer('input_tokens'),
  costUsd: numeric('cost_usd', { precision: 10, scale: 6 }),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => [
  uniqueIndex('jev_readings_capture_id_idx').on(table.captureId),
  index('jev_readings_source_id_idx').on(table.sourceId),
  index('jev_readings_created_at_idx').on(table.createdAt),
]);

export const jevReadingsRelations = relations(jevReadings, ({ one }) => ({
  source: one(sources, { fields: [jevReadings.sourceId], references: [sources.id] }),
  capture: one(captures, { fields: [jevReadings.captureId], references: [captures.id] }),
}));

// ─── Extractions (AI Scraper) ───────────────────────────────────────────────

export const extractions = pgTable('extractions', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: uuid('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }),
  captureId: uuid('capture_id').notNull().references(() => captures.id, { onDelete: 'cascade' }),
  runId: uuid('run_id').references(() => runs.id, { onDelete: 'set null' }),
  data: jsonb('data').notNull().default([]),
  rowCount: integer('row_count').default(0),
  confidence: integer('confidence'),
  validationResult: jsonb('validation_result'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('extractions_source_id_idx').on(table.sourceId),
  index('extractions_capture_id_idx').on(table.captureId),
  index('extractions_run_id_idx').on(table.runId),
]);

export const extractionsRelations = relations(extractions, ({ one }) => ({
  source: one(sources, { fields: [extractions.sourceId], references: [sources.id] }),
  capture: one(captures, { fields: [extractions.captureId], references: [captures.id] }),
  run: one(runs, { fields: [extractions.runId], references: [runs.id] }),
}));

// ─── Runs (Stage 2) ─────────────────────────────────────────────────────────

export const runs = pgTable('runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  extractorId: uuid('extractor_id').references(() => extractors.id, { onDelete: 'cascade' }),
  sourceId: uuid('source_id').references(() => sources.id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 50 }).notNull().default('pending'),
  inputLabel: varchar('input_label', { length: 255 }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  resultCount: integer('result_count'),
  // What this run's model calls cost, in USD, summed over both of its phases
  // (planning in plan-source.ts, execution in start-execution.ts) the way
  // source_verifications.cost_usd is measured for a Verify: the process-wide
  // usage counter (@robot/agent usage.ts) snapshotted before and after the
  // browser session. Two paid things in flight at once attribute each other's
  // tokens to whichever finishes — the same limit the verification figure has.
  // Usage (spec 2026-09-21 §5) adds this and the verification figure up.
  costUsd: numeric('cost_usd', { precision: 10, scale: 4 }).notNull().default('0'),
  results: jsonb('results'),
  html: text('html'),
  logs: text('logs'),
  replayData: text('replay_data'),
  errorMessage: text('error_message'),
  // The run this repair run was spawned to backfill fields for, if any.
  parentRunId: uuid('parent_run_id').references((): AnyPgColumn => runs.id, { onDelete: 'set null' }),
  // Fields a repair run targets for backfill: string[].
  targetFields: jsonb('target_fields'),
  // Field keys whose miss rate crossed DRIFT_MISS_SHARE in this run: string[].
  driftedFields: jsonb('drifted_fields'),
  // VariantRunSummary (@robot/scraper verify/variant-rows.ts): set only when this run's
  // extractions hold any variant row (spec 2026-10-02-variants-plan3). Null otherwise.
  variantSummary: jsonb('variant_summary'),
  // The job working on this row (spec 2026-10-23 §4.5); null for rows written outside the queue.
  jobId: uuid('job_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('runs_extractor_id_idx').on(table.extractorId),
  index('runs_source_id_idx').on(table.sourceId),
  index('runs_status_idx').on(table.status),
  index('runs_parent_run_id_idx').on(table.parentRunId),
  index('runs_job_id_idx').on(table.jobId),
]);

export const runsRelations = relations(runs, ({ one, many }) => ({
  extractor: one(extractors, { fields: [runs.extractorId], references: [extractors.id] }),
  source: one(sources, { fields: [runs.sourceId], references: [sources.id] }),
  captures: many(captures),
  extractions: many(extractions),
}));

// ─── Run Items (v2 crawler) ─────────────────────────────────────────────────
//
// Simultaneously the work list, the queue, and the per-URL status record. The
// unique (run_id, url) constraint is the dedupe mechanism: the same product
// appearing on two listing pages is queued once.

export const runItems = pgTable('run_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
  // 'listing' | 'detail'
  kind: varchar('kind', { length: 10 }).notNull(),
  url: text('url').notNull(),
  /** Which InputSet row this item descends from. */
  inputIndex: integer('input_index').notNull().default(0),
  /** Snapshot of that row, so a historical run stays reproducible if the InputSet changes. */
  inputValues: jsonb('input_values').notNull().default({}),
  /** Values captured on the listing page for this row (category, listing price, ...). */
  listingValues: jsonb('listing_values').notNull().default({}),
  /** Listing items: which page this is. Detail items: which page discovered the URL. */
  pageNumber: integer('page_number'),
  parentId: uuid('parent_id'),
  // 'pending' | 'running' | 'done' | 'failed'
  status: varchar('status', { length: 12 }).notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  error: text('error'),
  extractionId: uuid('extraction_id').references(() => extractions.id, { onDelete: 'set null' }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  /** Fields this item is being repaired for, if it was queued by a repair run: string[]. */
  targetFields: jsonb('target_fields'),
  /** Fields that came back absent after extraction, for this item: string[]. */
  absentFields: jsonb('absent_fields'),
  /** The group's `_product_key` (variant-rows.ts), set only for a queued variant page (links method). Null otherwise. */
  variantOf: text('variant_of'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('run_items_run_url_idx').on(table.runId, table.url),
  index('run_items_run_status_idx').on(table.runId, table.status),
  index('run_items_run_kind_idx').on(table.runId, table.kind),
]);

export const runItemsRelations = relations(runItems, ({ one }) => ({
  run: one(runs, { fields: [runItems.runId], references: [runs.id] }),
  extraction: one(extractions, { fields: [runItems.extractionId], references: [extractions.id] }),
  parent: one(runItems, { fields: [runItems.parentId], references: [runItems.id], relationName: 'run_item_parent' }),
}));

// ─── Run files and webhook deliveries (2026-10-24) ──────────────────────────
// Recurring extraction (spec 2026-10-24 §3.3–§3.4): a settled run's file, one row per format, written by its
// `run-delivery` job — the snapshot a webhook's links download (a later backfill's own delivery replaces it) —
// and one row per webhook attempt.

export const runFiles = pgTable('run_files', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
  // 'csv' | 'json' | 'xlsx'
  format: varchar('format', { length: 8 }).notNull(),
  // The download's name, as the live export names it (exportFilename).
  filename: text('filename').notNull(),
  bytes: bytea('bytes').notNull(),
  rows: integer('rows').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('run_files_run_format_idx').on(table.runId, table.format),
]);

export const webhookDeliveries = pgTable('webhook_deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
  // The same on every attempt of one run's delivery (the `X-Robot-Delivery` header).
  deliveryId: uuid('delivery_id').notNull(),
  attempt: integer('attempt').notNull(),
  ok: boolean('ok').notNull(),
  // Null when nothing answered (a refused address, a timeout, a connection error). Staff only.
  statusCode: integer('status_code'),
  error: text('error'),
  at: timestamp('at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('webhook_deliveries_run_at_idx').on(table.runId, table.at),
]);

// ─── Staff activity (spec 2026-10-07 §2.4) — append-only ────────────────────

export const staffActions = pgTable('staff_actions', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  actorEmail: varchar('actor_email', { length: 255 }).notNull(),
  at: timestamp('at', { withTimezone: true }).defaultNow().notNull(),
  action: varchar('action', { length: 100 }).notNull(),
  summary: text('summary').notNull(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
  sourceId: uuid('source_id').references(() => sources.id, { onDelete: 'set null' }),
  runId: uuid('run_id').references(() => runs.id, { onDelete: 'set null' }),
}, (table) => [
  index('staff_actions_org_at_idx').on(table.orgId, table.at),
  index('staff_actions_source_at_idx').on(table.sourceId, table.at),
]);

// ─── Email (spec 2026-10-24 email §3.3) ─────────────────────────────────────
// One row per message per recipient, written with its `email` job; the worker sends it. The row is the record.

export const EMAIL_KINDS = ['attention', 'run-failed', 'staff-access', 'role-changed', 'removed'] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];
export const EMAIL_STATUSES = ['queued', 'sent', 'failed', 'skipped'] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

export const emailMessages = pgTable('email_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  // Null once the user is deleted; a removed member's row keeps their id (the user still exists).
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  kind: varchar('kind', { length: 20 }).notNull(),
  // One message per recipient per event (spec §3.2): an insert that hits it does nothing.
  dedupeKey: varchar('dedupe_key', { length: 200 }).notNull(),
  toAddress: varchar('to_address', { length: 255 }).notNull(),
  subject: text('subject').notNull(),
  text: text('text').notNull(),
  html: text('html').notNull(),
  status: varchar('status', { length: 10 }).notNull().default('queued'),
  attempts: integer('attempts').notNull().default(0),
  // The last failed attempt's error. Staff only; never shown to a customer.
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
}, (table) => [
  uniqueIndex('email_messages_dedupe_key_idx').on(table.dedupeKey),
  index('email_messages_org_created_idx').on(table.orgId, table.createdAt),
]);
