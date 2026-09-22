/** The website's top tabs (spec 2026-09-21 §3) and the tab the path is on. Pure. */
export type SiteTabLabel = 'Schema' | 'Extract' | 'Runs' | 'Settings';

/**
 * `as const` rather than a `readonly Tab[]` annotation: the strip hands `t.to`
 * straight to `<Link to={…}>`, and the router only accepts a literal it knows.
 * Schema is the index, so it is the one that matches exactly — without that
 * every tab under it would light the first one too.
 */
export const SITE_TABS = [
  { to: '/projects/$project/sites/$site', label: 'Schema', exact: true },
  { to: '/projects/$project/sites/$site/extract', label: 'Extract', exact: false },
  { to: '/projects/$project/sites/$site/runs', label: 'Runs', exact: false },
  { to: '/projects/$project/sites/$site/settings', label: 'Settings', exact: false },
] as const;

/**
 * Which tab a path is on, given the website's base path. A single run
 * (`…/runs/<id>`) is still the Runs tab: it is where that tab took you, and a
 * strip with nothing lit reads as "you have left the website".
 */
export function activeTab(pathname: string, base: string): SiteTabLabel {
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : '';
  if (rest.startsWith('/extract')) return 'Extract';
  if (rest.startsWith('/runs')) return 'Runs';
  if (rest.startsWith('/settings')) return 'Settings';
  return 'Schema';
}
