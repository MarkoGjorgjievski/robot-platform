import { pgTable, text, timestamp, integer, jsonb, uuid, index } from 'drizzle-orm/pg-core';

export const quickExtractions = pgTable('quick_extractions', {
  id: uuid('id').primaryKey().defaultRandom(),
  url: text('url').notNull(),
  domain: text('domain').notNull(),
  extractedData: jsonb('extracted_data').notNull().default([]),
  fields: jsonb('fields').notNull().default([]),
  confidence: integer('confidence'),
  sources: jsonb('sources'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('quick_extractions_domain_idx').on(table.domain),
  index('quick_extractions_created_at_idx').on(table.createdAt),
]);
