import { router } from '../trpc';
import { authRouter } from './auth.js';
import { orgsRouter } from './orgs.js';
import { projectsRouter } from './projects';
import { datasetsRouter } from './datasets';
import { sourcesRouter } from './sources';
import { domainsRouter } from './domains';
import { runsRouter } from './runs';
import { crawlRouter } from './crawl';
import { scraperRouter } from './scraper';

export const appRouter = router({
  auth: authRouter,
  orgs: orgsRouter,
  projects: projectsRouter,
  datasets: datasetsRouter,
  sources: sourcesRouter,
  domains: domainsRouter,
  runs: runsRouter,
  crawl: crawlRouter,
  scraper: scraperRouter,
});

export type AppRouter = typeof appRouter;
