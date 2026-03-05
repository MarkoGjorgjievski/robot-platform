import { router } from '../trpc';
import { orgsRouter } from './orgs';
import { extractorsRouter } from './extractors';
import { domainsRouter } from './domains';
import { inputsRouter } from './inputs';
import { credentialsRouter } from './credentials';
import { runsRouter } from './runs';

export const appRouter = router({
  orgs: orgsRouter,
  extractors: extractorsRouter,
  domains: domainsRouter,
  inputs: inputsRouter,
  credentials: credentialsRouter,
  runs: runsRouter,
});

export type AppRouter = typeof appRouter;
