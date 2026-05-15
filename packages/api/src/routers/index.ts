import { router } from '../trpc';
import { orgsRouter } from './orgs';
import { projectsRouter } from './projects';
import { datasetsRouter } from './datasets';
import { sourcesRouter } from './sources';
import { extractorsRouter } from './extractors';
import { domainsRouter } from './domains';
import { inputsRouter } from './inputs';
import { credentialsRouter } from './credentials';
import { runsRouter } from './runs';
import { overridesRouter } from './overrides';
import { capturesRouter } from './captures';
import { extractionsRouter } from './extractions';

export const appRouter = router({
  orgs: orgsRouter,
  projects: projectsRouter,
  datasets: datasetsRouter,
  sources: sourcesRouter,
  extractors: extractorsRouter,
  domains: domainsRouter,
  inputs: inputsRouter,
  credentials: credentialsRouter,
  runs: runsRouter,
  overrides: overridesRouter,
  captures: capturesRouter,
  extractions: extractionsRouter,
});

export type AppRouter = typeof appRouter;
