import { router } from '../trpc';
import { authRouter } from './auth.js';
import { orgsRouter } from './orgs.js';
import { projectsRouter } from './projects';
import { datasetsRouter } from './datasets';
import { sourcesRouter } from './sources';
import { domainsRouter } from './domains';
import { opsRouter } from './ops.js';
import { runsRouter } from './runs';
import { crawlRouter } from './crawl';
import { scraperRouter } from './scraper';
import { usageRouter } from './usage.js';

export const appRouter = router({
  auth: authRouter,
  orgs: orgsRouter,
  projects: projectsRouter,
  datasets: datasetsRouter,
  sources: sourcesRouter,
  domains: domainsRouter,
  ops: opsRouter,
  runs: runsRouter,
  crawl: crawlRouter,
  scraper: scraperRouter,
  usage: usageRouter,
});

export type AppRouter = typeof appRouter;
