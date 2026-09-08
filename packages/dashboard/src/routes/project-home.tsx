// packages/dashboard/src/routes/project-home.tsx
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { DEFAULT_ORG_SLUG } from '../lib/constants';
import { siteNameFromUrl } from '../lib/site-name';
import { Spinner, ErrorBanner, NotFound } from '../components/page-states';
import { Dialog, fieldClass, labelClass } from '../components/dialog';
import { InlineRename } from '../components/inline-rename';

type DatasetField = { key?: string; name: string; type: string };

/** Project home (spec 5.3): fields on the left, websites on the right, output underneath. */
export default function ProjectHome() {
  const { project: projectSlug } = useParams({ from: '/projects/$project' });
  const utils = trpc.useUtils();
  const statsQuery = trpc.projects.getWithStats.useQuery({ orgSlug: DEFAULT_ORG_SLUG, projectSlug });
  const sourcesQuery = trpc.sources.listByProject.useQuery({ orgSlug: DEFAULT_ORG_SLUG, projectSlug });
  const projectId = statsQuery.data?.project.id;
  const datasetsQuery = trpc.datasets.listByProject.useQuery({ projectId: projectId ?? '' }, { enabled: !!projectId });
  const rename = trpc.projects.rename.useMutation({ onSuccess: () => { utils.projects.getWithStats.invalidate(); utils.projects.list.invalidate(); } });
  const [adding, setAdding] = useState(false);

  if (statsQuery.isLoading) return <Spinner label="Loading project..." />;
  if (statsQuery.isError) return <ErrorBanner message={statsQuery.error.message} />;
  if (!statsQuery.data) return <NotFound what={`Project "${projectSlug}"`} />;

  const { project } = statsQuery.data;
  const sources = sourcesQuery.data ?? [];
  const datasets = datasetsQuery.data ?? [];
  const fields = datasets.flatMap((d) => (Array.isArray(d.schema) ? (d.schema as DatasetField[]) : []));

  return (
    <div>
      <div className="text-xs text-gray-500"><Link to="/projects" className="hover:text-gray-700">Projects</Link></div>
      <InlineRename value={project.name} pending={rename.isPending} onSave={(name) => rename.mutate({ projectId: project.id, name })} className="mt-1 text-xl font-semibold tracking-tight" />
      {project.description && <p className="mt-1 text-sm text-gray-600">{project.description}</p>}

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <section>
          <h2 className="text-sm font-medium text-gray-900">Fields <span className="font-normal text-gray-500">the columns of your output</span></h2>
          {fields.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">No fields yet. Fields are edited on a website's Schema tab for now.</p>
          ) : (
            <table className="mt-2 w-full text-sm">
              <thead className="text-xs text-gray-600"><tr><th className="py-1 text-left font-medium">Field</th><th className="py-1 text-left font-medium">Type</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {fields.map((f, i) => <tr key={f.key ?? i}><td className="py-1.5 font-mono text-xs">{f.name}</td><td className="py-1.5 text-gray-600">{f.type}</td></tr>)}
              </tbody>
            </table>
          )}
        </section>

        <section>
          <h2 className="text-sm font-medium text-gray-900">Websites <span className="font-normal text-gray-500">where the fields are proven and extracted</span></h2>
          <ul className="mt-2 space-y-1.5">
            {sources.map((s) => <WebsiteRow key={s.id} projectSlug={projectSlug} source={s} />)}
            <li>
              <button type="button" onClick={() => setAdding(true)} className="flex w-full items-center gap-3 rounded-lg border border-dashed border-gray-300 px-3 py-2.5 text-left text-sm text-gray-600 hover:border-gray-400 hover:bg-gray-50">
                + Add website <span className="text-xs text-gray-400">name it, then pick three product pages</span>
              </button>
            </li>
          </ul>
          {datasets.length > 0 && (
            <div className="mt-4 flex items-center gap-3 rounded-lg bg-gray-100 px-3 py-2 text-xs text-gray-700">
              <span className="font-medium">Output</span>
              <span>{fields.length} columns</span>
              <Link to="/projects/$project/output" params={{ project: projectSlug }} className="ml-auto underline-offset-2 hover:underline">Open</Link>
            </div>
          )}
        </section>
      </div>

      <AddWebsiteDialog open={adding} onClose={() => setAdding(false)} projectSlug={projectSlug} />
    </div>
  );
}

function WebsiteRow({ projectSlug, source }: { projectSlug: string; source: { id: string; slug: string; name: string; urlTemplate: string | null; schemaDefinition: unknown } }) {
  const status = trpc.sources.verificationStatus.useQuery({ sourceId: source.id });
  const total = Array.isArray(source.schemaDefinition) ? source.schemaDefinition.length : 0;
  const results = (status.data?.results ?? {}) as Record<string, { certified?: unknown[] }>;
  const passed = Object.values(results).filter((f) => Array.isArray(f.certified) && f.certified.length > 0).length;
  const current = !!status.data?.current;
  const label = total === 0 ? 'no fields yet' : current && status.data?.allPassed ? `${total} of ${total} verified` : `${current ? passed : 0} of ${total} verified`;
  const dot = total === 0 ? 'bg-gray-300' : current && status.data?.allPassed ? 'bg-emerald-600' : 'bg-red-500';
  let host = '';
  try { host = source.urlTemplate ? new URL(source.urlTemplate).hostname : ''; } catch { host = ''; }
  return (
    <li>
      <Link to="/projects/$project/sources/$source" params={{ project: projectSlug, source: source.slug }} className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm hover:bg-gray-50/60">
        <span className="font-medium">{source.name}</span>
        <span className="font-mono text-xs text-gray-500">{host}</span>
        <span className="ml-auto inline-flex items-center gap-2 text-xs text-gray-600"><span className={`h-2 w-2 rounded-full ${dot}`} />{label}</span>
      </Link>
    </li>
  );
}

function AddWebsiteDialog({ open, onClose, projectSlug }: { open: boolean; onClose: () => void; projectSlug: string }) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const create = trpc.sources.createInProject.useMutation({
    onSuccess: (r) => {
      utils.sources.listByProject.invalidate({ orgSlug: DEFAULT_ORG_SLUG, projectSlug });
      utils.projects.list.invalidate();
      onClose();
      navigate({ to: '/projects/$project/sources/$source', params: { project: r.projectSlug, source: r.sourceSlug } });
    },
  });

  useEffect(() => {
    if (!open) { setUrl(''); setName(''); setNameTouched(false); create.reset(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function onUrlChange(v: string) {
    setUrl(v);
    if (!nameTouched) setName(siteNameFromUrl(v));
  }

  const closeIfIdle = () => { if (!create.isPending) onClose(); };

  return (
    <Dialog open={open} title="Add website" onClose={closeIfIdle} preventClose={create.isPending}>
      <form onSubmit={(e) => { e.preventDefault(); create.mutate({ projectSlug, name, url }); }}>
        <label className={labelClass}>Any page on the website
          <input autoFocus value={url} onChange={(e) => onUrlChange(e.target.value)} className={`${fieldClass} font-mono`} placeholder="https://www.abebooks.com/" />
        </label>
        <label className={`${labelClass} mt-3`}>Name
          <input value={name} onChange={(e) => { setNameTouched(true); setName(e.target.value); }} className={fieldClass} placeholder="AbeBooks" />
        </label>
        <p className="mt-1 text-xs text-gray-500">Prefilled from the address. Change it to anything.</p>
        <p className="mt-2 text-xs text-gray-500">Next you'll pick three product pages and fill in the expected values.</p>
        {create.isError && <p className="mt-2 text-xs text-red-700">{create.error.message}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-quiet h-9" disabled={create.isPending} onClick={closeIfIdle}>Cancel</button>
          <button type="submit" className="btn-primary h-9" disabled={!name.trim() || !/^https?:\/\//.test(url) || create.isPending}>
            {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Add website
          </button>
        </div>
      </form>
    </Dialog>
  );
}
