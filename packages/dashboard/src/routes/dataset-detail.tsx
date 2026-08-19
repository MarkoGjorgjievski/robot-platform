import { useState } from 'react';
import { useParams, Link } from '@tanstack/react-router';
import { Layers, ArrowRight } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { Spinner, ErrorBanner, EmptyState, NotFound } from '../components/page-states';
import { DEFAULT_ORG_SLUG } from '../lib/constants';
import { FIELD_ORIGINS, originLabel, type FieldOrigin } from '../lib/field-origin';

type SchemaField = {
  name: string;
  type: string;
  description?: string;
  required?: boolean;
  origin?: FieldOrigin;
  input_column?: string;
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

      <SchemaFieldOrigins datasetId={dataset.id} schema={schema} />

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

function SchemaFieldOrigins({ datasetId, schema }: { datasetId: string; schema: SchemaField[] }) {
  const [fields, setFields] = useState<SchemaField[]>(schema);
  const utils = trpc.useUtils();
  const updateSchema = trpc.datasets.updateSchema.useMutation({
    onSuccess: () => utils.datasets.invalidate(),
  });

  function setOrigin(index: number, origin: FieldOrigin) {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, origin } : f)));
  }

  if (fields.length === 0) {
    return <p className="mt-6 text-sm text-gray-500">This dataset has no schema fields yet.</p>;
  }

  return (
    <div className="mt-6">
      <h2 className="text-sm font-semibold text-gray-700">Schema fields</h2>
      <p className="mt-1 text-xs text-gray-500">
        Where each value comes from. Listing-page fields are captured while crawling and carried
        down to every detail row.
      </p>
      <table className="mt-3 w-full text-sm">
        <thead className="border-b">
          <tr>
            <th className="py-2 pr-4 text-left text-xs font-medium text-gray-600">Field</th>
            <th className="py-2 pr-4 text-left text-xs font-medium text-gray-600">Type</th>
            <th className="py-2 pr-4 text-left text-xs font-medium text-gray-600">Comes from</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field, i) => (
            <tr key={field.name} className="border-b last:border-b-0">
              <td className="py-2 pr-4 font-mono text-xs">{field.name}</td>
              <td className="py-2 pr-4 font-mono text-xs text-gray-500">{field.type}</td>
              <td className="py-2 pr-4">
                <select
                  value={field.origin ?? 'detail'}
                  onChange={(e) => setOrigin(i, e.target.value as FieldOrigin)}
                  className="rounded border px-2 py-1 text-xs"
                >
                  {FIELD_ORIGINS.map((origin) => (
                    <option key={origin} value={origin}>{originLabel(origin)}</option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        onClick={() => updateSchema.mutate({ datasetId, schema: fields })}
        disabled={updateSchema.isPending}
        className="mt-3 rounded border px-3 py-1 text-xs font-medium hover:bg-gray-50 disabled:opacity-50"
      >
        {updateSchema.isPending ? 'Saving...' : 'Save field origins'}
      </button>
      {updateSchema.isError && (
        <p className="mt-2 text-xs text-red-600">{updateSchema.error.message}</p>
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
