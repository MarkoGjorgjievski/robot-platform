import { pgTable, text, timestamp, boolean, integer, jsonb, uuid, varchar, index, uniqueIndex, check } from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

// ─── Organizations ───────────────────────────────────────────────────────────

export const orgs = pgTable('orgs', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }).notNull().unique(),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const orgsRelations = relations(orgs, ({ many }) => ({
  extractors: many(extractors),
  projects: many(projects),
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
  country: varchar('country', { length: 10 }).notNull(),
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
  // Fields a repair run asked this source to backfill: Array<{name, hint?, addedAt}>.
  requestedFields: jsonb('requested_fields'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('sources_dataset_id_idx').on(table.datasetId),
  index('sources_domain_id_idx').on(table.domainId),
  uniqueIndex('sources_dataset_slug_idx').on(table.datasetId, table.slug),
  index('sources_input_set_id_idx').on(table.inputSetId),
  index('sources_is_sandbox_idx').on(table.isSandbox),
  check('sources_non_sandbox_requires_dataset', sql`${table.isSandbox} = true OR ${table.datasetId} IS NOT NULL`),
]);

export const sourcesRelations = relations(sources, ({ one, many }) => ({
  dataset: one(datasets, { fields: [sources.datasetId], references: [datasets.id] }),
  domain: one(domains, { fields: [sources.domainId], references: [domains.id] }),
  runs: many(runs),
  captures: many(captures),
  extractions: many(extractions),
  inputSet: one(inputSets, { fields: [sources.inputSetId], references: [inputSets.id] }),
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
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('captures_source_id_idx').on(table.sourceId),
  index('captures_run_id_idx').on(table.runId),
]);

export const capturesRelations = relations(captures, ({ one, many }) => ({
  source: one(sources, { fields: [captures.sourceId], references: [sources.id] }),
  extractions: many(extractions),
  run: one(runs, { fields: [captures.runId], references: [runs.id] }),
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
  results: jsonb('results'),
  html: text('html'),
  logs: text('logs'),
  replayData: text('replay_data'),
  errorMessage: text('error_message'),
  // The run this repair run was spawned to backfill fields for, if any.
  parentRunId: uuid('parent_run_id').references((): AnyPgColumn => runs.id, { onDelete: 'set null' }),
  // Fields a repair run targets for backfill: string[].
  targetFields: jsonb('target_fields'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('runs_extractor_id_idx').on(table.extractorId),
  index('runs_source_id_idx').on(table.sourceId),
  index('runs_status_idx').on(table.status),
  index('runs_parent_run_id_idx').on(table.parentRunId),
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
