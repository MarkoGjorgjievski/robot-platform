import {
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { Layout } from './components/layout';
import { Placeholder } from './components/placeholder';

import SandboxIndex from './routes/sandbox-index';
import SandboxDetail from './routes/sandbox-detail';
import ProjectHome from './routes/project-home';
import DatasetsList from './routes/datasets-list';
import DatasetDetail from './routes/dataset-detail';
import InputSetsList from './routes/inputsets-list';
import InputSetDetail from './routes/inputset-detail';
import ProjectDomainsList from './routes/project-domains-list';
import ProjectDomainDetail from './routes/project-domain-detail';
import SourcesList from './routes/sources-list';
import SourceDetail from './routes/source-detail';
import SourceConfig from './routes/source-config';
import SourceInputs from './routes/source-inputs';
import SourceRuns from './routes/source-runs';
import SourceRunDetail from './routes/source-run-detail';
import DomainsList from './routes/domains-list';
import DomainDetail from './routes/domain-detail';

const rootRoute = createRootRoute({ component: Layout });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => <Placeholder title="Robot Platform" phase="Phase 2 (Sandbox)" />,
});

const sandboxIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sandbox',
  component: SandboxIndex,
});

const sandboxDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sandbox/$shortid',
  component: SandboxDetail,
});

const projectHomeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/p/$project',
  component: ProjectHome,
});

const datasetsListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/p/$project/datasets',
  component: DatasetsList,
});

const datasetDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/p/$project/datasets/$dataset',
  component: DatasetDetail,
});

const inputSetsListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/p/$project/inputs',
  component: InputSetsList,
});

const inputSetDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/p/$project/inputs/$inputset',
  component: InputSetDetail,
});

const projectDomainsListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/p/$project/domains',
  component: ProjectDomainsList,
});

const projectDomainDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/p/$project/domains/$domain',
  component: ProjectDomainDetail,
});

const sourcesListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/p/$project/sources',
  component: SourcesList,
});

const sourceDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/p/$project/sources/$source',
  component: SourceDetail,
});

const sourceConfigRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/p/$project/sources/$source/config',
  component: SourceConfig,
});

const sourceInputsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/p/$project/sources/$source/inputs',
  component: SourceInputs,
});

const sourceRunsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/p/$project/sources/$source/runs',
  component: SourceRuns,
});

const sourceRunDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/p/$project/sources/$source/runs/$run',
  component: SourceRunDetail,
});

const domainsListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/domains',
  component: DomainsList,
});

const domainDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/domains/$domain',
  component: DomainDetail,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  sandboxIndexRoute,
  sandboxDetailRoute,
  projectHomeRoute,
  datasetsListRoute,
  datasetDetailRoute,
  inputSetsListRoute,
  inputSetDetailRoute,
  projectDomainsListRoute,
  projectDomainDetailRoute,
  sourcesListRoute,
  sourceDetailRoute,
  sourceConfigRoute,
  sourceInputsRoute,
  sourceRunsRoute,
  sourceRunDetailRoute,
  domainsListRoute,
  domainDetailRoute,
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
