import { useParams, Link } from '@tanstack/react-router';
import { Layers, ArrowRight } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { Spinner, ErrorBanner, EmptyState, NotFound } from '../components/page-states';
import { DEFAULT_ORG_SLUG } from '../lib/constants';

type SchemaField = {
  name: string;
  type: string;
  description?: string;
  required?: boolean;
};

export default function DatasetDetail() {
  const { project: projectSlug, dataset: datasetSlug } = useParams({
    from: '/p/$project/datasets/$dataset',
  });

  const detailQuery = trpc.datasets.getBySlug.useQuery({
    orgSlug: DEFAULT_ORG_SLUG,
    projectSlug,
    datasetSlug,
  });

  if (detailQuery.isLoading) return <Spinner label="Loading dataset..." />;
  if (detailQuery.isError) return <ErrorBanner message={detailQuery.error.message} />;
  if (!detailQuery.data) return <NotFound what={`Dataset "${datasetSlug}"`} />;

  const dataset = detailQuery.data;
  const schema = (Array.isArray(dataset.schema) ? dataset.schema : []) as SchemaField[];
  const sources = (dataset as { sources?: Array<{ id: string; slug: string; name: string }> }).sources ?? [];

  return (
    <div>
      <Breadcrumbs projectSlug={projectSlug} datasetName={dataset.name} />
      <h1 className="mt-2 text-xl font-bold tracking-tight">{dataset.name}</h1>
      {dataset.description && (
        <p className="mt-1 text-sm text-gray-600">{dataset.description}</p>
      )}

      <h2 className="mt-6 text-sm font-semibold text-gray-700">Schema</h2>
      {schema.length === 0 ? (
        <EmptyState
          title="No fields defined yet"
          description="The schema editor with field-source classification is coming in Phase 3b."
        />
      ) : (
        <table className="mt-2 w-full text-sm">
          <thead className="border-b">
            <tr>
              <th className="py-2 text-left font-medium text-gray-600">Field</th>
              <th className="py-2 text-left font-medium text-gray-600">Type</th>
              <th className="py-2 text-left font-medium text-gray-600">Required</th>
              <th className="py-2 text-left font-medium text-gray-600">Description</th>
            </tr>
          </thead>
          <tbody>
            {schema.map((f) => (
              <tr key={f.name} className="border-b last:border-b-0">
                <td className="py-2 font-mono text-xs">{f.name}</td>
                <td className="py-2 text-xs text-gray-600">{f.type}</td>
                <td className="py-2 text-xs text-gray-500">{f.required ? 'yes' : 'no'}</td>
                <td className="py-2 text-xs text-gray-500">{f.description ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="mt-8 text-sm font-semibold text-gray-700">
        Sources ({sources.length})
      </h2>
      {sources.length === 0 ? (
        <EmptyState
          title="No sources yet"
          description="Sources for this dataset will appear here when they're created. (Bulk-create UX coming in Phase 3b.)"
        />
      ) : (
        <ul className="mt-2 divide-y rounded-md border">
          {sources.map((s) => (
            <li key={s.id}>
              <Link
                to="/p/$project/sources/$source"
                params={{ project: projectSlug, source: s.slug }}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-50"
              >
                <Layers className="h-4 w-4 text-gray-400" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{s.name}</div>
                </div>
                <ArrowRight className="h-4 w-4 text-gray-400" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Breadcrumbs({ projectSlug, datasetName }: { projectSlug: string; datasetName: string }) {
  return (
    <div className="flex items-center gap-1 text-xs text-gray-500">
      <Link to="/projects" className="hover:text-gray-700">Projects</Link>
      <span>/</span>
      <Link to="/p/$project" params={{ project: projectSlug }} className="hover:text-gray-700">
        Project
      </Link>
      <span>/</span>
      <Link to="/p/$project/datasets" params={{ project: projectSlug }} className="hover:text-gray-700">
        Datasets
      </Link>
      <span>/</span>
      <span className="text-gray-700">{datasetName}</span>
    </div>
  );
}
