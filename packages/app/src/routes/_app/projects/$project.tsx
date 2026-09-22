import { Outlet, createFileRoute } from '@tanstack/react-router';
import { trpc } from '../../../lib/trpc';

/**
 * The project layout: everything under /projects/:project. It renders only the
 * outlet — the shell's header and sidebar read the project through `useProject`
 * — so the one query is shared by the breadcrumb, the sidebar's project section
 * and whichever screen is open, under one cache key.
 */
export const Route = createFileRoute('/_app/projects/$project')({
  component: () => <Outlet />,
});

export function useProject() {
  const { project } = Route.useParams();
  return trpc.projects.get.useQuery({ projectSlug: project });
}
