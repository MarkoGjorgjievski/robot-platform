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
  /** The address shown is FALLBACK_PROXY_URL, which the website switched to on its own (spec 2026-10-28 §3.3). */
  proxyFromFallback: boolean;
  /** When the website switched to the fallback proxy after being turned away; null when it never did. */
  fallbackProxyAt: Date | string | null;
};

export const NETWORK_TITLE = 'Network (staff)';
export const NETWORK_HELP =
  "Every page of this website loads through this proxy, as if from this country. The address check when a website is added and the listing page check go direct. Use {country} in the address for the website's country.";
export const NO_COUNTRY = 'none';
export const NO_COUNTRY_LABEL = 'No preference';

type ProxyState = Pick<NetworkSettings, 'proxyUrl' | 'proxyFromDefault'> & { proxyFromFallback?: boolean };

export function proxyStateLine(n: ProxyState): string {
  if (!n.proxyUrl) return 'No proxy: pages load directly.';
  if (n.proxyFromFallback) return `The fallback, switched to automatically: ${n.proxyUrl}`;
  return n.proxyFromDefault ? `The default: ${n.proxyUrl}` : `This website's own: ${n.proxyUrl}`;
}

/** Spec 2026-10-28 §3.3 "Undo": the line above "Go direct again", or null when the website never switched. UTC date. */
export function fallbackSwitchLine(at: Date | string | null): string | null {
  if (!at) return null;
  const d = typeof at === 'string' ? new Date(at) : at;
  if (Number.isNaN(d.getTime())) return null;
  return `Switched to the fallback proxy on ${d.toISOString().slice(0, 10)} after being turned away`;
}
export const GO_DIRECT = 'Go direct again';

/** Why Save is off (said beside it), or null. The server's own sentences say the rest. */
export function proxySaveReason(typed: string): string | null {
  return typed.trim() === '' ? 'Type a proxy address to save' : null;
}

/** Why "Use the default" is off, or null. */
export function useDefaultReason(n: ProxyState): string | null {
  return n.proxyUrl && !n.proxyFromDefault && !n.proxyFromFallback ? null : 'This website has no address of its own';
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
