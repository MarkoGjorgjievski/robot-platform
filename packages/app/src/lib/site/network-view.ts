// The Network (staff) panel on a website's Settings (spec 2026-10-24 proxy §2.3). Staff only: the server sends these
// fields to staff alone (`sources.get`), and the panel is drawn only when they are there. Pure.

export type NetworkSettings = {
  /** Masked by the server: http://user:•••@host:port. */
  proxyUrl: string | null;
  proxyFromDefault: boolean;
  country: string | null;
  countries: Array<{ code: string; name: string }>;
  /** Why the address cannot be used (pages fail with "The proxy refused the connection."), or null. */
  problem: string | null;
};

export const NETWORK_TITLE = 'Network (staff)';
export const NETWORK_HELP =
  "Every page of this website loads through this proxy, as if from this country. The address check when a website is added and the listing page check go direct. Use {country} in the address for the website's country.";
export const NO_COUNTRY = 'none';
export const NO_COUNTRY_LABEL = 'No preference';

export function proxyStateLine(n: Pick<NetworkSettings, 'proxyUrl' | 'proxyFromDefault'>): string {
  if (!n.proxyUrl) return 'No proxy: pages load directly.';
  return n.proxyFromDefault ? `The default: ${n.proxyUrl}` : `This website's own: ${n.proxyUrl}`;
}

/** Why Save is off (said beside it), or null. The server's own sentences say the rest. */
export function proxySaveReason(typed: string): string | null {
  return typed.trim() === '' ? 'Type a proxy address to save' : null;
}

/** Why "Use the default" is off, or null. */
export function useDefaultReason(n: Pick<NetworkSettings, 'proxyUrl' | 'proxyFromDefault'>): string | null {
  return n.proxyUrl && !n.proxyFromDefault ? null : 'This website has no address of its own';
}

export function countryChoices(countries: NetworkSettings['countries']): Array<{ value: string; label: string }> {
  return [
    { value: NO_COUNTRY, label: NO_COUNTRY_LABEL },
    ...[...countries].sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ value: c.code, label: c.name })),
  ];
}

export function countryFromChoice(value: string): string | null {
  return value === NO_COUNTRY ? null : value;
}
