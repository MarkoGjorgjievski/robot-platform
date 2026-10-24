// packages/api/src/email/config.ts
// Email configuration (spec 2026-10-24 email §6). The api-server and the worker build links on PUBLIC_APP_URL.
export type Env = Record<string, string | undefined>;

/** The app as a person opens it; every link in an email is built on it. */
export function publicAppUrl(env: Env = process.env): string {
  return (env.PUBLIC_APP_URL ?? '').trim().replace(/\/+$/, '') || 'http://localhost:3000';
}

/** Spec §3.3: the sender; a provider needs a verified one. The product name appears only here, and it is configurable. */
export const DEFAULT_MAIL_FROM = '"Robot Platform" <no-reply@localhost>';

/** Where the worker sends (e.g. smtp://127.0.0.1:1025 for Mailpit); null — empty or unset — means mail is off. */
export function smtpUrl(env: Env = process.env): string | null {
  return (env.SMTP_URL ?? '').trim() || null;
}

export function mailFrom(env: Env = process.env): string {
  return (env.MAIL_FROM ?? '').trim() || DEFAULT_MAIL_FROM;
}

export function mailOn(env: Env = process.env): boolean {
  return smtpUrl(env) !== null;
}
