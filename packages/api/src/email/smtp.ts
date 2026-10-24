// packages/api/src/email/smtp.ts
// One message over SMTP with nodemailer (spec 2026-10-24 email §3.3): SMTP_URL as given — smtp:// (STARTTLS when the
// server offers it) or smtps:// (TLS), credentials in the URL — so a real provider is configuration only (§6).
// A 15 s limit on connecting, on the greeting, on each read, and on the whole send.
import nodemailer, { type SMTPTransportOptions } from 'nodemailer';

export const SEND_TIMEOUT_MS = 15_000;

export type OutgoingMail = { from: string; to: string; subject: string; text: string; html: string };

export function smtpOptions(url: string, timeoutMs = SEND_TIMEOUT_MS): SMTPTransportOptions {
  if (!/^smtps?:\/\//i.test(url)) throw new Error('SMTP_URL must start with smtp:// or smtps://');
  return { url, connectionTimeout: timeoutMs, greetingTimeout: timeoutMs, socketTimeout: timeoutMs };
}

/** Text that may carry SMTP_URL, with its user:password taken out — before any log or stored error. */
export function redactSmtp(text: string, url?: string | null): string {
  let out = text.replace(/(smtps?:\/\/)[^@\s/]*@/gi, '$1***@');
  if (url) {
    try {
      const u = new URL(url);
      for (const secret of [u.password, decodeURIComponent(u.password), u.username, decodeURIComponent(u.username)]) {
        if (secret) out = out.split(secret).join('***');
      }
    } catch { /* not a URL: the pattern above is all there is */ }
  }
  return out;
}

export async function sendSmtp(url: string, mail: OutgoingMail, timeoutMs = SEND_TIMEOUT_MS): Promise<void> {
  const transport = nodemailer.createTransport(smtpOptions(url, timeoutMs));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      transport.sendMail(mail),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`the mail server did not finish within ${timeoutMs} ms`)), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
    transport.close();
  }
}
