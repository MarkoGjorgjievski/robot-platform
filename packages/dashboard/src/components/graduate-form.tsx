import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Loader2, X } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { ErrorBanner } from './page-states';
import { slugify } from '../lib/slugify';

type Props = {
  sandboxSlug: string;
  defaultSourceName: string;
  onCancel: () => void;
};

export function GraduateForm({ sandboxSlug, defaultSourceName, onCancel }: Props) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  // Project state
  const [projectMode, setProjectMode] = useState<'existing' | 'new'>('new');
  const [existingProjectSlug, setExistingProjectSlug] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectSlug, setNewProjectSlug] = useState('');
  const [newProjectSlugTouched, setNewProjectSlugTouched] = useState(false);

  // Dataset state
  const [datasetMode, setDatasetMode] = useState<'existing' | 'new'>('new');
  const [existingDatasetSlug, setExistingDatasetSlug] = useState('');
  const [newDatasetName, setNewDatasetName] = useState('');
  const [newDatasetSlug, setNewDatasetSlug] = useState('');
  const [newDatasetSlugTouched, setNewDatasetSlugTouched] = useState(false);

  // Source state
  const [sourceName, setSourceName] = useState(defaultSourceName);
  const [sourceSlug, setSourceSlug] = useState(slugify(defaultSourceName));
  const [sourceSlugTouched, setSourceSlugTouched] = useState(false);

  // InputSet promotion state
  const [promoteInputSet, setPromoteInputSet] = useState(false);
  const [inputSetName, setInputSetName] = useState('');

  const [error, setError] = useState<string | null>(null);

  // Reset dataset selection when project mode flips to 'new' (existing dataset no longer applies)
  useEffect(() => {
    if (projectMode === 'new') {
      setDatasetMode('new');
      setExistingDatasetSlug('');
    }
  }, [projectMode]);

  // Auto-derive slug from name unless user has touched the slug field
  useEffect(() => {
    if (!newProjectSlugTouched) setNewProjectSlug(slugify(newProjectName));
  }, [newProjectName, newProjectSlugTouched]);
  useEffect(() => {
    if (!newDatasetSlugTouched) setNewDatasetSlug(slugify(newDatasetName));
  }, [newDatasetName, newDatasetSlugTouched]);
  useEffect(() => {
    if (!sourceSlugTouched) setSourceSlug(slugify(sourceName));
  }, [sourceName, sourceSlugTouched]);

  // Project dropdown options — query existing non-sandbox projects
  const projectsQuery = trpc.projects.list.useQuery();
  const availableProjects = useMemo(
    () => (projectsQuery.data ?? []).filter((p) => p.slug !== 'sandbox'),
    [projectsQuery.data],
  );

  // Dataset dropdown options — depend on chosen existing project
  const selectedProjectId = useMemo(() => {
    if (projectMode !== 'existing' || !existingProjectSlug) return null;
    return availableProjects.find((p) => p.slug === existingProjectSlug)?.id ?? null;
  }, [projectMode, existingProjectSlug, availableProjects]);
  const datasetsQuery = trpc.datasets.listByProject.useQuery(
    { projectId: selectedProjectId ?? '' },
    { enabled: !!selectedProjectId },
  );

  const graduateMutation = trpc.sandbox.graduate.useMutation({
    onSuccess: ({ projectSlug, sourceSlug: returnedSourceSlug }) => {
      utils.sandbox.list.invalidate();
      utils.sandbox.get.invalidate({ slug: sandboxSlug });
      utils.projects.list.invalidate();
      navigate({
        to: '/p/$project/sources/$source',
        params: { project: projectSlug, source: returnedSourceSlug },
      });
    },
    onError: (err) => setError(err.message),
  });

  function handleSubmit() {
    setError(null);

    const projectInput =
      projectMode === 'existing'
        ? { mode: 'existing' as const, existingSlug: existingProjectSlug }
        : { mode: 'new' as const, newName: newProjectName.trim(), newSlug: newProjectSlug.trim() };
    const datasetInput =
      datasetMode === 'existing'
        ? { mode: 'existing' as const, existingSlug: existingDatasetSlug }
        : { mode: 'new' as const, newName: newDatasetName.trim(), newSlug: newDatasetSlug.trim() };
    const sourceInput = { name: sourceName.trim(), slug: sourceSlug.trim() };

    if (projectMode === 'existing' && !existingProjectSlug) {
      setError('Pick a project'); return;
    }
    if (projectMode === 'new' && (!newProjectName.trim() || !newProjectSlug.trim())) {
      setError('Project needs a name and slug'); return;
    }
    if (datasetMode === 'existing' && !existingDatasetSlug) {
      setError('Pick a dataset'); return;
    }
    if (datasetMode === 'new' && (!newDatasetName.trim() || !newDatasetSlug.trim())) {
      setError('Dataset needs a name and slug'); return;
    }
    if (!sourceInput.name || !sourceInput.slug) {
      setError('Source needs a name and slug'); return;
    }
    if (promoteInputSet && !inputSetName.trim()) {
      setError('Provide an InputSet name to promote it'); return;
    }

    graduateMutation.mutate({
      slug: sandboxSlug,
      project: projectInput,
      dataset: datasetInput,
      source: sourceInput,
      promoteInputSet: promoteInputSet ? { name: inputSetName.trim() } : undefined,
    });
  }

  const pending = graduateMutation.isPending;
  const canPickExistingProject = availableProjects.length > 0;
  const canPickExistingDataset = projectMode === 'existing' && (datasetsQuery.data?.length ?? 0) > 0;

  return (
    <div className="mt-6 rounded-md border border-gray-300 bg-gray-50 p-5">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Graduate to a real project</h2>
          <p className="mt-1 text-xs text-gray-600">
            Move this Sandbox source into a Project + Dataset. Runs and extracted data are preserved.
          </p>
        </div>
        <button
          onClick={onCancel}
          disabled={pending}
          className="text-gray-400 hover:text-gray-700 disabled:opacity-50"
          aria-label="Cancel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Project picker */}
      <fieldset className="mt-4">
        <legend className="text-xs font-medium text-gray-700">Project</legend>
        <div className="mt-2 flex gap-3 text-sm">
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={projectMode === 'existing'}
              onChange={() => setProjectMode('existing')}
              disabled={pending || !canPickExistingProject}
            />
            Existing
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={projectMode === 'new'}
              onChange={() => setProjectMode('new')}
              disabled={pending}
            />
            Create new
          </label>
        </div>

        {projectMode === 'existing' && (
          <select
            value={existingProjectSlug}
            onChange={(e) => setExistingProjectSlug(e.target.value)}
            disabled={pending}
            className="mt-2 h-9 w-full rounded-md border border-gray-300 px-2 text-sm disabled:opacity-50"
          >
            <option value="">Choose a project…</option>
            {availableProjects.map((p) => (
              <option key={p.id} value={p.slug}>{p.name}</option>
            ))}
          </select>
        )}

        {projectMode === 'new' && (
          <div className="mt-2 grid grid-cols-2 gap-3">
            <input
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="Project name"
              disabled={pending}
              className="h-9 rounded-md border border-gray-300 px-2 text-sm disabled:opacity-50"
            />
            <input
              type="text"
              value={newProjectSlug}
              onChange={(e) => {
                setNewProjectSlugTouched(true);
                setNewProjectSlug(e.target.value);
              }}
              placeholder="project-slug"
              disabled={pending}
              className="h-9 rounded-md border border-gray-300 px-2 font-mono text-xs disabled:opacity-50"
            />
          </div>
        )}
      </fieldset>

      {/* Dataset picker */}
      <fieldset className="mt-4">
        <legend className="text-xs font-medium text-gray-700">Dataset</legend>
        <div className="mt-2 flex gap-3 text-sm">
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={datasetMode === 'existing'}
              onChange={() => setDatasetMode('existing')}
              disabled={pending || projectMode !== 'existing' || !canPickExistingDataset}
            />
            Existing
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={datasetMode === 'new'}
              onChange={() => setDatasetMode('new')}
              disabled={pending}
            />
            Create new
          </label>
        </div>

        {datasetMode === 'existing' && (
          <select
            value={existingDatasetSlug}
            onChange={(e) => setExistingDatasetSlug(e.target.value)}
            disabled={pending || projectMode !== 'existing'}
            className="mt-2 h-9 w-full rounded-md border border-gray-300 px-2 text-sm disabled:opacity-50"
          >
            <option value="">
              {projectMode !== 'existing' ? 'Pick an existing project first' : 'Choose a dataset…'}
            </option>
            {(datasetsQuery.data ?? []).map((d) => (
              <option key={d.id} value={d.slug}>{d.name}</option>
            ))}
          </select>
        )}

        {datasetMode === 'new' && (
          <div className="mt-2 grid grid-cols-2 gap-3">
            <input
              type="text"
              value={newDatasetName}
              onChange={(e) => setNewDatasetName(e.target.value)}
              placeholder="Dataset name (e.g. Products)"
              disabled={pending}
              className="h-9 rounded-md border border-gray-300 px-2 text-sm disabled:opacity-50"
            />
            <input
              type="text"
              value={newDatasetSlug}
              onChange={(e) => {
                setNewDatasetSlugTouched(true);
                setNewDatasetSlug(e.target.value);
              }}
              placeholder="dataset-slug"
              disabled={pending}
              className="h-9 rounded-md border border-gray-300 px-2 font-mono text-xs disabled:opacity-50"
            />
          </div>
        )}
      </fieldset>

      {/* Source name/slug */}
      <fieldset className="mt-4">
        <legend className="text-xs font-medium text-gray-700">Source</legend>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <input
            type="text"
            value={sourceName}
            onChange={(e) => setSourceName(e.target.value)}
            placeholder="Source name"
            disabled={pending}
            className="h-9 rounded-md border border-gray-300 px-2 text-sm disabled:opacity-50"
          />
          <input
            type="text"
            value={sourceSlug}
            onChange={(e) => {
              setSourceSlugTouched(true);
              setSourceSlug(e.target.value);
            }}
            placeholder="source-slug"
            disabled={pending}
            className="h-9 rounded-md border border-gray-300 px-2 font-mono text-xs disabled:opacity-50"
          />
        </div>
      </fieldset>

      {/* Optional InputSet promotion */}
      <fieldset className="mt-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={promoteInputSet}
            onChange={(e) => setPromoteInputSet(e.target.checked)}
            disabled={pending}
          />
          <span>Promote inline InputSet to a named one</span>
        </label>
        {promoteInputSet && (
          <input
            type="text"
            value={inputSetName}
            onChange={(e) => setInputSetName(e.target.value)}
            placeholder="InputSet name (e.g. Acme ASINs Q1)"
            disabled={pending}
            className="mt-2 h-9 w-full rounded-md border border-gray-300 px-2 text-sm disabled:opacity-50"
          />
        )}
        {!promoteInputSet && (
          <p className="mt-1 text-xs text-gray-500">
            Leave inline (default). You can promote later when this list needs to be reused across sources.
          </p>
        )}
      </fieldset>

      {error && <ErrorBanner message={error} />}

      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="h-9 rounded-md border border-gray-300 px-4 text-sm font-medium text-gray-700 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={pending}
          className="flex h-9 items-center gap-2 rounded-md bg-gray-900 px-4 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          Graduate
        </button>
      </div>
    </div>
  );
}
