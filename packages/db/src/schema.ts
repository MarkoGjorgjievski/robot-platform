import { pgTable, text, timestamp, boolean, integer, jsonb, uuid, varchar, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ─── Organizations ───────────────────────────────────────────────────────────

export const orgs = pgTable('orgs', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }).notNull().unique(),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
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
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('projects_org_id_idx').on(table.orgId),
  uniqueIndex('projects_org_slug_idx').on(table.orgId, table.slug),
]);

export const projectsRelations = relations(projects, ({ one, many }) => ({
  org: one(orgs, { fields: [projects.orgId], references: [orgs.id] }),
  collections: many(collections),
}));

// ─── Collections ────────────────────────────────────────────────────────────

export const collections = pgTable('collections', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }).notNull(),
  description: text('description'),
  schema: jsonb('schema'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('collections_project_id_idx').on(table.projectId),
  uniqueIndex('collections_project_slug_idx').on(table.projectId, table.slug),
]);

export const collectionsRelations = relations(collections, ({ one, many }) => ({
  project: one(projects, { fields: [collections.projectId], references: [projects.id] }),
  sources: many(sources),
}));

// ─── Sources (new extractors) ───────────────────────────────────────────────

export const sources = pgTable('sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  collectionId: uuid('collection_id').notNull().references(() => collections.id, { onDelete: 'cascade' }),
  domainId: uuid('domain_id').references(() => domains.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
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
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('sources_collection_id_idx').on(table.collectionId),
  index('sources_domain_id_idx').on(table.domainId),
  uniqueIndex('sources_collection_slug_idx').on(table.collectionId, table.slug),
]);

export const sourcesRelations = relations(sources, ({ one, many }) => ({
  collection: one(collections, { fields: [sources.collectionId], references: [collections.id] }),
  domain: one(domains, { fields: [sources.domainId], references: [domains.id] }),
  runs: many(runs),
  inputs: many(sourceInputs),
}));

// ─── Source Inputs ────────────────────────────────────────────────────────────

export const sourceInputs = pgTable('source_inputs', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: uuid('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }),
  label: varchar('label', { length: 255 }).notNull(),
  inputData: jsonb('input_data').notNull().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('source_inputs_source_id_idx').on(table.sourceId),
]);

export const sourceInputsRelations = relations(sourceInputs, ({ one }) => ({
  source: one(sources, { fields: [sourceInputs.sourceId], references: [sources.id] }),
}));

// ─── Domains ─────────────────────────────────────────────────────────────────

export const domains = pgTable('domains', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  prefix: varchar('prefix', { length: 10 }),
  hasGotoOverride: boolean('has_goto_override').default(false).notNull(),
  hasSetZipCodeOverride: boolean('has_set_zip_code_override').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
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
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
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
  createdAt: timestamp('created_at').defaultNow().notNull(),
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
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
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
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('robot_overrides_domain_id_idx').on(table.domainId),
]);

export const robotOverridesRelations = relations(robotOverrides, ({ one }) => ({
  domain: one(domains, { fields: [robotOverrides.domainId], references: [domains.id] }),
}));

// ─── Runs (Stage 2) ─────────────────────────────────────────────────────────

export const runs = pgTable('runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  extractorId: uuid('extractor_id').references(() => extractors.id, { onDelete: 'cascade' }),
  sourceId: uuid('source_id').references(() => sources.id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 50 }).notNull().default('pending'),
  inputLabel: varchar('input_label', { length: 255 }),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  resultCount: integer('result_count'),
  results: jsonb('results'),
  html: text('html'),
  logs: text('logs'),
  replayData: text('replay_data'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('runs_extractor_id_idx').on(table.extractorId),
  index('runs_source_id_idx').on(table.sourceId),
  index('runs_status_idx').on(table.status),
]);

export const runsRelations = relations(runs, ({ one }) => ({
  extractor: one(extractors, { fields: [runs.extractorId], references: [extractors.id] }),
  source: one(sources, { fields: [runs.sourceId], references: [sources.id] }),
}));
