import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL ?? 'postgresql://localhost:5432/robot_platform';

const client = postgres(connectionString);
export const db = drizzle(client, { schema });

export * from './schema';
export { quickExtractions } from './quick-extractions.js';
export type Database = typeof db;
