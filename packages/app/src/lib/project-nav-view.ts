/** The project section of the sidebar and the breadcrumb (spec 2026-09-21 §3). Pure. */
export type ProjectNavItem = {
  to: '/projects/$project' | '/projects/$project/fields' | '/projects/$project/output';
  label: string;
  /** The home is the section's index: active only on its own path, or every child would light it too. */
  exact: boolean;
};

export const PROJECT_NAV: readonly ProjectNavItem[] = [
  { to: '/projects/$project', label: 'Websites', exact: true },
  { to: '/projects/$project/fields', label: 'Fields', exact: false },
  { to: '/projects/$project/output', label: 'Output', exact: false },
];

/**
 * A union rather than one shape with two optional fields: a crumb that links
 * always has its params, and typing it that way is what lets `<Link to={c.to}
 * params={c.params}>` narrow — with both optional, `params` is possibly
 * undefined and the router rejects it.
 */
export type Crumb =
  | { label: string; to?: undefined; params?: undefined }
  | { label: string; to: '/projects/$project'; params: { project: string } };

export function crumbs(org: string, project: { name: string; slug: string } | null): Crumb[] {
  const out: Crumb[] = [{ label: org }];
  if (project) out.push({ label: project.name, to: '/projects/$project', params: { project: project.slug } });
  return out;
}
