/**
 * Old paths keep working forever (spec 3.1). This is the one table that says
 * where each one goes now; the router's redirect routes call it.
 */
export function legacyTarget(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, '') || '/';

  const domains = path.match(/^\/domains(\/.*)?$/);
  if (domains) return `/ops/domains${domains[1] ?? ''}`;

  const project = path.match(/^\/p\/([^/]+)(\/.*)?$/);
  if (!project) return null;
  const [, slug, rest = ''] = project;
  const base = `/projects/${slug}`;

  if (rest === '' ) return base;
  if (/^\/datasets(\/.*)?$/.test(rest)) return `${base}/output`;
  if (/^\/inputs(\/.*)?$/.test(rest)) return base;
  if (/^\/domains(\/.*)?$/.test(rest)) return `${base}${rest}`;

  const source = rest.match(/^\/sources\/([^/]+)(\/.*)?$/);
  if (source) {
    const [, sourceSlug, tail = ''] = source;
    const sbase = `${base}/sources/${sourceSlug}`;
    if (tail === '' || tail === '/setup') return sbase;
    if (tail === '/config') return `${sbase}/settings`;
    return `${sbase}${tail}`;
  }
  return `${base}${rest}`;
}
