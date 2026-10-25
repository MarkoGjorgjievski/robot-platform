// The markets a website can be read from (spec 2026-10-24 proxy §2.1): staff pick one per website; it fills a proxy
// address's `{country}` and sets the browser's locale and time zone. Pure; the api and the ops screens read it too.

export type Country = { code: string; name: string; locale: string; timezoneId: string };

export const COUNTRIES: readonly Country[] = [
  { code: 'us', name: 'United States', locale: 'en-US', timezoneId: 'America/New_York' },
  { code: 'ca', name: 'Canada', locale: 'en-CA', timezoneId: 'America/Toronto' },
  { code: 'mx', name: 'Mexico', locale: 'es-MX', timezoneId: 'America/Mexico_City' },
  { code: 'br', name: 'Brazil', locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' },
  { code: 'gb', name: 'United Kingdom', locale: 'en-GB', timezoneId: 'Europe/London' },
  { code: 'ie', name: 'Ireland', locale: 'en-IE', timezoneId: 'Europe/Dublin' },
  { code: 'fr', name: 'France', locale: 'fr-FR', timezoneId: 'Europe/Paris' },
  { code: 'de', name: 'Germany', locale: 'de-DE', timezoneId: 'Europe/Berlin' },
  { code: 'at', name: 'Austria', locale: 'de-AT', timezoneId: 'Europe/Vienna' },
  { code: 'ch', name: 'Switzerland', locale: 'de-CH', timezoneId: 'Europe/Zurich' },
  { code: 'nl', name: 'Netherlands', locale: 'nl-NL', timezoneId: 'Europe/Amsterdam' },
  { code: 'be', name: 'Belgium', locale: 'nl-BE', timezoneId: 'Europe/Brussels' },
  { code: 'es', name: 'Spain', locale: 'es-ES', timezoneId: 'Europe/Madrid' },
  { code: 'it', name: 'Italy', locale: 'it-IT', timezoneId: 'Europe/Rome' },
  { code: 'pl', name: 'Poland', locale: 'pl-PL', timezoneId: 'Europe/Warsaw' },
  { code: 'se', name: 'Sweden', locale: 'sv-SE', timezoneId: 'Europe/Stockholm' },
  { code: 'dk', name: 'Denmark', locale: 'da-DK', timezoneId: 'Europe/Copenhagen' },
  { code: 'no', name: 'Norway', locale: 'nb-NO', timezoneId: 'Europe/Oslo' },
  { code: 'au', name: 'Australia', locale: 'en-AU', timezoneId: 'Australia/Sydney' },
  { code: 'jp', name: 'Japan', locale: 'ja-JP', timezoneId: 'Asia/Tokyo' },
];

/** The market for a stored or typed code, whatever its case; null for none or one not in the table. */
export function countryByCode(code: string | null | undefined): Country | null {
  const c = (code ?? '').trim().toLowerCase();
  return COUNTRIES.find((x) => x.code === c) ?? null;
}
