// packages/dashboard/src/router.tsx
import {
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from '@tanstack/react-router';
import { Layout } from './components/layout';
import { legacyTarget } from './lib/legacy-routes';

import ProjectsList from './routes/projects-list';
import ProjectHome from './routes/project-home';
import ProjectOutput from './routes/project-output';
import ProjectDomainsList from './routes/project-domains-list';
import ProjectDomainDetail from './routes/project-domain-detail';
import SourcesList from './routes/sources-list';
import SourceDetail from './routes/source-detail';
import SourceSchema from './routes/source-schema';
import SourceOverview from './routes/source-overview';
import SourceConfig from './routes/source-config';
import SourceRuns from './routes/source-runs';
import SourceRunDetail from './routes/source-run-detail';
import DomainsList from './routes/domains-list';
import DomainDetail from './routes/domain-detail';

const rootRoute = createRootRoute({ component: Layout });

// Home is the projects list. After auth, `/` becomes the landing page and
// signed-in users still land on /projects (spec 3.3).
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/projects' });
  },
});

const projectsListRoute = createRoute({ getParentRoute: () => rootRoute, path: '/projects', component: ProjectsList });
const projectHomeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/projects/$project', component: ProjectHome });
const projectOutputRoute = createRoute({ getParentRoute: () => rootRoute, path: '/projects/$project/output', component: ProjectOutput });
const projectDomainsListRoute = createRoute({ getParentRoute: () => rootRoute, path: '/projects/$project/domains', component: ProjectDomainsList });
const projectDomainDetailRoute = createRoute({ getParentRoute: () => rootRoute, path: '/projects/$project/domains/$domain', component: ProjectDomainDetail });
const sourcesListRoute = createRoute({ getParentRoute: () => rootRoute, path: '/projects/$project/sources', component: SourcesList });

const sourceDetailLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects/$project/sources/$source',
  component: SourceDetail,
});
// The bare source URL is the Schema tab, always (spec 5.6).
const sourceSchemaRoute = createRoute({ getParentRoute: () => sourceDetailLayoutRoute, path: '/', component: SourceSchema });
const sourceOverviewRoute = createRoute({ getParentRoute: () => sourceDetailLayoutRoute, path: 'overview', component: SourceOverview });
const sourceSettingsRoute = createRoute({ getParentRoute: () => sourceDetailLayoutRoute, path: 'settings', component: SourceConfig });
const sourceRunsRoute = createRoute({ getParentRoute: () => sourceDetailLayoutRoute, path: 'runs', component: SourceRuns });

// Run detail stays at root level: own breadcrumbs, no tabs.
const sourceRunDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects/$project/sources/$source/runs/$run',
  component: SourceRunDetail,
});

// Operator views. Out of the customer nav, still routed (spec 3.1).
const opsDomainsListRoute = createRoute({ getParentRoute: () => rootRoute, path: '/ops/domains', component: DomainsList });
const opsDomainDetailRoute = createRoute({ getParentRoute: () => rootRoute, path: '/ops/domains/$domain', component: DomainDetail });

// Legacy paths. `legacyTarget` is the single table of where each one went;
// these three routes only exist to catch the old prefixes and call it.
function legacyRedirect({ location }: { location: { pathname: string } }): never {
  const target = legacyTarget(location.pathname) ?? '/projects';
  throw redirect({ to: target as never });
}
const legacyProjectRoute = createRoute({ getParentRoute: () => rootRoute, path: '/p/$project', beforeLoad: legacyRedirect });
const legacyProjectSplatRoute = createRoute({ getParentRoute: () => rootRoute, path: '/p/$project/$', beforeLoad: legacyRedirect });
const legacyDomainsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/domains', beforeLoad: legacyRedirect });
const legacyDomainDetailRoute = createRoute({ getParentRoute: () => rootRoute, path: '/domains/$', beforeLoad: legacyRedirect });

const routeTree = rootRoute.addChildren([
  indexRoute,
  projectsListRoute,
  projectHomeRoute,
  projectOutputRoute,
  projectDomainsListRoute,
  projectDomainDetailRoute,
  sourcesListRoute,
  sourceDetailLayoutRoute.addChildren([sourceSchemaRoute, sourceOverviewRoute, sourceSettingsRoute, sourceRunsRoute]),
  sourceRunDetailRoute,
  opsDomainsListRoute,
  opsDomainDetailRoute,
  legacyProjectRoute,
  legacyProjectSplatRoute,
  legacyDomainsRoute,
  legacyDomainDetailRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

export function AppRouter() {
  return <RouterProvider router={router} />;
}
