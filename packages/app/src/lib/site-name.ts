const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu']);

/** "https://shop.currys.co.uk/x" → "Currys". Prefill only; the customer edits it (spec 5.4). */
export function siteNameFromUrl(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return '';
  }
  const labels = host.toLowerCase().split('.').filter(Boolean);
  if (labels.length < 2) return '';
  let i = labels.length - 2;
  if (i > 0 && SECOND_LEVEL.has(labels[i]!) && labels[labels.length - 1]!.length === 2) i -= 1;
  const label = labels[i]!;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * The host as typed, for the quiet line under a website's name — "shop.currys.co.uk".
 * The whole host, not the registrable domain: two websites in one project can
 * differ only by subdomain, and that is exactly what the customer needs to see.
 */
export function hostnameOf(url: string | null): string {
  if (!url) return '';
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}
