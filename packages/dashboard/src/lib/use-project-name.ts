import { trpc } from './trpc';
import { DEFAULT_ORG_SLUG } from './constants';

/**
 * The project's display name for a breadcrumb, given only the slug from the
 * route.
 *
 * Three screens used to print the literal word "Project" or the lowercase
 * slug in the crumb where the name belongs, which tells the customer nothing
 * and disagrees with the two screens that got it right. The query is the same
 * one `project-output.tsx` already runs, so on those routes it is a cache hit;
 * elsewhere it is one small request. The slug is the fallback — while the
 * query is in flight and if it fails — so the crumb is never empty.
 */
export function useProjectName(projectSlug: string): string {
  const query = trpc.projects.getBySlug.useQuery({ orgSlug: DEFAULT_ORG_SLUG, projectSlug });
  return query.data?.name ?? projectSlug;
}
