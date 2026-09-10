import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from '@tanstack/react-router';
import { trpc } from '../lib/trpc';
import { Spinner, ErrorBanner, EmptyState, NotFound } from '../components/page-states';
import { PageHeader } from '../components/page-header';
import { DEFAULT_ORG_SLUG } from '../lib/constants';
import { FIELD_ORIGINS, originLabel, type FieldOrigin } from '../lib/field-origin';
import { pickerOptions, pickerOptionLabel, sourceHostnames, type CandidateCatalogue } from '../lib/candidate-picker';

type SchemaField = {
  name: string;
  type: string;
  description?: string;
  required?: boolean;
  origin?: FieldOrigin;
  input_column?: string;
  /** The customer's explicit candidate choice for this field (v2.5 serving order). */
  candidate?: { concept: string; label: string };
};

type Source = { id: string; slug: string; name: string; urlTemplate?: string };

export default function DatasetDetail({ datasetSlug }: { datasetSlug: string }) {
  const { project: projectSlug } = useParams({ from: '/projects/$project/output' });

  const detailQuery = trpc.datasets.getBySlug.useQuery({
    orgSlug: DEFAULT_ORG_SLUG,
    projectSlug,
    datasetSlug,
  });

  if (detailQuery.isLoading) return <Spinner label="Loading output..." />;
  if (detailQuery.isError) return <ErrorBanner message={detailQuery.error.message} />;
  if (!detailQuery.data) return <NotFound what={`Output "${datasetSlug}"`} />;

  const dataset = detailQuery.data;
  const schema = (Array.isArray(dataset.schema) ? dataset.schema : []) as SchemaField[];
  const sources = (dataset as { sources?: Source[] }).sources ?? [];

  return (
    <div>
      <Breadcrumbs projectSlug={projectSlug} />
      <div className="mt-2">
        <PageHeader title="Output" description={dataset.description ?? `Every column in ${dataset.name}.`} />
      </div>

      <SchemaFieldOrigins datasetId={dataset.id} schema={schema} sources={sources} />

      <h2 className="name mt-8 text-lg">Websites</h2>
      <p className="label-soft mt-0.5">Where these columns are proven and extracted.</p>
      {sources.length === 0 ? (
        <EmptyState
          title="No websites yet"
          description="Add a website on the project page and it appears here."
        />
      ) : (
        <table className="sheet mt-2">
          <thead>
            <tr className="sheet-row">
              <th className="sheet-head px-3 py-2 text-left">Name</th>
              <th className="sheet-head px-3 py-2 text-left">Address</th>
              <th className="sheet-head px-3 py-2 text-left"> </th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.id} className="sheet-row h-8">
                <td className="px-3"><span className="name text-[15px]">{s.name}</span></td>
                <td className="max-w-xs truncate px-3 font-mono text-xs text-gray-600">{s.urlTemplate ?? ''}</td>
                <td className="px-3 text-right">
                  <Link
                    to="/projects/$project/sources/$source"
                    params={{ project: projectSlug, source: s.slug }}
                    className="text-xs text-accent-700 underline-offset-2 hover:underline"
                  >
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SchemaFieldOrigins({ datasetId, schema, sources }: { datasetId: string; schema: SchemaField[]; sources: Source[] }) {
  const [fields, setFields] = useState<SchemaField[]>(schema);
  // Re-sync local state when the server's schema changes (e.g. another session
  // saved a different origin, or this save's own invalidate() refetches it).
  // Only fires when the `schema` prop reference actually changes, so it doesn't
  // clobber an in-progress edit on every render — only on a genuine server update.
  useEffect(() => {
    setFields(schema);
  }, [schema]);
  const utils = trpc.useUtils();
  const updateSchema = trpc.datasets.updateSchema.useMutation({
    onSuccess: () => utils.datasets.invalidate(),
  });

  // Candidates come from domain intelligence, keyed by hostname — not from the
  // dataset itself — so every distinct hostname touched by this dataset's
  // sources needs its own catalogue fetched and merged before a field row can
  // offer a picker. Verbatim hostnames (www included) — `domain_intelligence`
  // rows are stored keyed by the exact hostname the page was captured at
  // (final-review fix; see `sourceHostnames`'s doc comment).
  const hostnames = useMemo(() => sourceHostnames(sources), [sources]);

  const catalogueQueries = trpc.useQueries((t) =>
    hostnames.map((hostname) => t.domains.intelligenceDetail({ domain: hostname })),
  );

  // Candidates carry their contributing hostname (controller ruling R6) so a
  // dataset that spans more than one source hostname can show provenance
  // instead of silently letting the first hostname's label win a collision.
  // `catalogueQueries[i]` corresponds to `hostnames[i]` — `trpc.useQueries`
  // preserves the input array's order.
  const catalogue = useMemo<CandidateCatalogue>(() => {
    const merged: CandidateCatalogue = {};
    catalogueQueries.forEach((q, i) => {
      const hostname = hostnames[i];
      for (const pt of q.data?.pageTypes ?? []) {
        for (const [concept, candidates] of Object.entries((pt.catalogue ?? {}) as CandidateCatalogue)) {
          const existing = merged[concept] ?? [];
          const seenLabels = new Set(existing.map((c) => c.label));
          const withHostname = candidates
            .filter((c) => !seenLabels.has(c.label))
            .map((c) => ({ ...c, hostname }));
          merged[concept] = [...existing, ...withHostname];
        }
      }
    });
    return merged;
  }, [catalogueQueries, hostnames]);
  const multiHostname = hostnames.length > 1;

  function setOrigin(index: number, origin: FieldOrigin) {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, origin } : f)));
  }

  // Not a functional updater: this reads the `fields` closed over from render
  // and calls `updateSchema.mutate` as a plain side effect afterward, rather
  // than inside a `setFields` updater callback — React (StrictMode in
  // particular) may invoke an updater function twice, which would fire the
  // mutation twice per selection if the mutate call lived inside it.
  function setCandidate(index: number, candidate?: { concept: string; label: string }) {
    const next = fields.map((f, i) => {
      if (i !== index) return f;
      if (!candidate) {
        const { candidate: _drop, ...rest } = f;
        return rest;
      }
      return { ...f, candidate };
    });
    setFields(next);
    updateSchema.mutate({ datasetId, schema: next });
  }

  if (fields.length === 0) {
    return <p className="mt-6 text-sm text-gray-600">There are no fields yet. Add them on the project page.</p>;
  }

  return (
    <div className="mt-6">
      <h2 className="name text-lg">Fields</h2>
      <p className="label-soft mt-0.5">
        Where each value comes from. Listing-page fields are captured while crawling and carried
        down to every product row.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="sheet">
          <thead>
            <tr className="sheet-row">
              <th className="sheet-head px-3 py-2 text-left">Field</th>
              <th className="sheet-head px-3 py-2 text-left">Type</th>
              <th className="sheet-head px-3 py-2 text-left">Required</th>
              <th className="sheet-head px-3 py-2 text-left">Description</th>
              <th className="sheet-head px-3 py-2 text-left">Comes from</th>
              <th className="sheet-head px-3 py-2 text-left">Candidate</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((field, i) => {
              const options = pickerOptions(catalogue, field.name, field.candidate);
              return (
                <tr key={field.name} className="sheet-row h-8">
                  <td className="px-3 font-mono text-xs">{field.name}</td>
                  <td className="px-3 font-mono text-xs text-gray-600">{field.type}</td>
                  <td className="px-3 text-xs text-gray-600">{field.required ? 'yes' : 'no'}</td>
                  <td className="px-3 text-xs text-gray-600">{field.description ?? '—'}</td>
                  <td className="px-3">
                    <select
                      value={field.origin ?? 'detail'}
                      onChange={(e) => setOrigin(i, e.target.value as FieldOrigin)}
                      className="rounded-md border border-gray-300 bg-gray-50 px-2 py-1 text-xs focus:border-accent-600 focus:outline-none"
                    >
                      {FIELD_ORIGINS.map((origin) => (
                        <option key={origin} value={origin}>{originLabel(origin)}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3">
                    {options ? (
                      <select
                        value={field.candidate?.label ?? 'default'}
                        onChange={(e) => {
                          const value = e.target.value;
                          if (value === 'default') {
                            setCandidate(i, undefined);
                            return;
                          }
                          const chosen = options.find((o) => o.label === value);
                          if (chosen) setCandidate(i, { concept: chosen.concept, label: chosen.label });
                        }}
                        className="rounded-md border border-gray-300 bg-gray-50 px-2 py-1 text-xs focus:border-accent-600 focus:outline-none"
                      >
                        <option value="default">default</option>
                        {options.map((o) => (
                          <option key={o.label} value={o.label}>
                            {pickerOptionLabel(o, { multiHostname })}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button
        onClick={() => updateSchema.mutate({ datasetId, schema: fields })}
        disabled={updateSchema.isPending}
        className="btn-quiet mt-3"
      >
        {updateSchema.isPending ? 'Saving...' : 'Save field origins'}
      </button>
      {updateSchema.isError && (
        <p className="mt-2 text-xs text-fail">{updateSchema.error.message}</p>
      )}
    </div>
  );
}

function Breadcrumbs({ projectSlug }: { projectSlug: string }) {
  return (
    <div className="flex items-center gap-1 text-xs text-gray-600">
      <Link to="/projects" className="hover:text-gray-900">Projects</Link>
      <span>/</span>
      <Link to="/projects/$project" params={{ project: projectSlug }} className="hover:text-gray-900">
        {projectSlug}
      </Link>
      <span>/</span>
      <span className="text-gray-900">Output</span>
    </div>
  );
}
