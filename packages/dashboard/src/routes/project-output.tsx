// packages/dashboard/src/routes/project-output.tsx
import { useParams } from '@tanstack/react-router';
import { trpc } from '../lib/trpc';
import { DEFAULT_ORG_SLUG } from '../lib/constants';
import { Spinner, ErrorBanner, NotFound } from '../components/page-states';
import DatasetDetail from './dataset-detail';
import DatasetsList from './datasets-list';

/**
 * /projects/:project/output. A project normally has one dataset, so this
 * shows that dataset's table straight away; with several it lists them
 * (spec 3.1, 5.3).
 */
export default function ProjectOutput() {
  const { project: projectSlug } = useParams({ from: '/projects/$project/output' });
  const projectQuery = trpc.projects.getBySlug.useQuery({ orgSlug: DEFAULT_ORG_SLUG, projectSlug });

  if (projectQuery.isLoading) return <Spinner label="Loading output..." />;
  if (projectQuery.isError) return <ErrorBanner message={projectQuery.error.message} />;
  if (!projectQuery.data) return <NotFound what={`Project "${projectSlug}"`} />;

  const datasets = projectQuery.data.datasets;
  if (datasets.length === 1) return <DatasetDetail datasetSlug={datasets[0]!.slug} />;
  return <DatasetsList />;
}
