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
import { ContractEditor } from '../components/contract-editor';

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

  return (
    <div>
      <div className="text-xs text-gray-600"><Link to="/projects" className="hover:text-gray-900">Projects</Link></div>
      <InlineRename value={project.name} pending={rename.isPending} onSave={(name) => rename.mutate({ projectId: project.id, name })} className="mt-1 text-2xl leading-[1.2]" />
      {project.description && <p className="mt-1 text-xs text-gray-600">{project.description}</p>}

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <section>
          <h2 className="name text-lg">Fields</h2>
          <p className="label-soft mt-0.5">The columns of your output.</p>
          <div className="mt-2">
            {datasets[0] ? <ContractEditor datasetId={datasets[0].id} projectSlug={projectSlug} /> : <p className="text-sm text-gray-600">Loading…</p>}
          </div>
        </section>

        <section>
          <h2 className="name text-lg">Websites</h2>
          <p className="label-soft mt-0.5">Where the fields are proven and extracted.</p>
          <ul className="mt-2 space-y-1.5">
            {sources.map((s) => <WebsiteRow key={s.id} projectSlug={projectSlug} source={s} />)}
          </ul>
          <button type="button" onClick={() => setAdding(true)} className="btn-primary mt-3 h-9">Add website</button>
          <p className="label-soft mt-1.5">Name it, then pick three product pages.</p>
          {datasets.length > 0 && (
            <div className="mt-6 border-t border-gray-200 pt-3">
              <p className="label-soft">Output</p>
              <p className="mt-0.5 text-sm">
                <span className="font-mono">{Array.isArray(datasets[0]?.schema) ? (datasets[0]!.schema as Array<{ key?: unknown }>).filter((f) => typeof f.key === 'string').length : 0}</span> columns.{' '}
                <Link to="/projects/$project/output" params={{ project: projectSlug }} className="text-accent-700 underline-offset-2 hover:underline">Open</Link>
              </p>
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
  // Spec 7 gives four status tokens so "not finished" and "wrong" never share
  // a colour. A website that has fields but has never been verified has not
  // failed — nobody has asked yet — so it takes the neutral `changed` rail.
  // `fail` is reserved for a current verification that actually reported a
  // failing field; `warn` is partly done (some fields proven, the rest moved
  // on since the last run).
  const rail =
    total === 0 ? 'border-l-warn'
      : current ? (status.data?.allPassed ? 'border-l-pass' : 'border-l-fail')
        : passed === 0 ? 'border-l-changed'
          : 'border-l-warn';
  let host = '';
  try { host = source.urlTemplate ? new URL(source.urlTemplate).hostname : ''; } catch { host = ''; }
  return (
    <li>
      <Link to="/projects/$project/sources/$source" params={{ project: projectSlug, source: source.slug }} className="card flex items-center gap-3 px-3 py-2.5 hover:bg-gray-100">
        <span className="name text-[15px]">{source.name}</span>
        <span className="font-mono text-xs text-gray-600">{host}</span>
        <span className={`label-soft ml-auto border-l-[3px] pl-2 ${rail}`}>{label}</span>
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
        <p className="mt-1 text-xs text-gray-600">Prefilled from the address. Change it to anything.</p>
        <p className="mt-2 text-xs text-gray-600">Next you'll pick three product pages and fill in the expected values.</p>
        {create.isError && <p className="mt-2 text-xs text-fail">{create.error.message}</p>}
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
