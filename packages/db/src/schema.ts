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
  extractorId: uuid('extractor_id').notNull().references(() => extractors.id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 50 }).notNull().default('pending'),
  inputLabel: varchar('input_label', { length: 255 }),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  resultCount: integer('result_count'),
  results: jsonb('results'),
  logs: text('logs'),
  videoUrl: text('video_url'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('runs_extractor_id_idx').on(table.extractorId),
  index('runs_status_idx').on(table.status),
]);

export const runsRelations = relations(runs, ({ one }) => ({
  extractor: one(extractors, { fields: [runs.extractorId], references: [extractors.id] }),
}));
