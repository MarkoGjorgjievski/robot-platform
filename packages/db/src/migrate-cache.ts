import { db } from './index.js';
import { sql } from 'drizzle-orm';

await db.execute(sql`DROP TABLE IF EXISTS domain_intelligence CASCADE`);
console.log('dropped domain_intelligence');

await db.execute(sql`
  CREATE TABLE domain_intelligence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain VARCHAR(255) NOT NULL,
    page_type VARCHAR(50) NOT NULL,
    api_endpoints JSONB DEFAULT '[]',
    field_paths JSONB DEFAULT '{}',
    popup_selectors JSONB DEFAULT '[]',
    has_json_ld BOOLEAN NOT NULL DEFAULT false,
    has_next_data BOOLEAN NOT NULL DEFAULT false,
    total_runs INTEGER NOT NULL DEFAULT 0,
    successful_runs INTEGER NOT NULL DEFAULT 0,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    last_used_at TIMESTAMP DEFAULT NOW() NOT NULL,
    last_verified_at TIMESTAMP DEFAULT NOW() NOT NULL,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL
  )
`);
await db.execute(sql`CREATE INDEX domain_intelligence_domain_idx ON domain_intelligence(domain)`);
await db.execute(sql`CREATE UNIQUE INDEX domain_intelligence_domain_page_type_idx ON domain_intelligence(domain, page_type)`);
console.log('created domain_intelligence with field_paths column');

process.exit(0);
