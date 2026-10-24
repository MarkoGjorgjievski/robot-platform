// packages/api/src/email/config.ts
// Email configuration (spec 2026-10-24 email §6). The api-server and the worker build links on PUBLIC_APP_URL.
export type Env = Record<string, string | undefined>;

/** The app as a person opens it; every link in an email is built on it. */
export function publicAppUrl(env: Env = process.env): string {
  return (env.PUBLIC_APP_URL ?? '').trim().replace(/\/+$/, '') || 'http://localhost:3000';
}
