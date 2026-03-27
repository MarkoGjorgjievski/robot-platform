import Link from 'next/link';
import { notFound } from 'next/navigation';
import { api } from '@/trpc/server';
import { Plus, ArrowLeft, Database, Globe, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

function StatusBadge({ status }: { status: string | null }) {
  const map: Record<string, string> = {
    analyzing: 'status-analyzing',
    ready: 'status-ready',
    running: 'status-running',
    error: 'status-error',
    pending: 'status-pending',
  };
  const cls = map[status ?? 'pending'] ?? 'status-pending';
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {status ?? 'pending'}
    </span>
  );
}

export default async function CustomerPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  let org;
  try {
    org = await api.orgs.getBySlug({ slug: orgSlug });
  } catch {
    notFound();
  }

  const projects = await api.projects.listByOrg({ orgId: org.id });

  // Gather all collections (schemas) and sources across projects
  const allCollections: Array<{
    id: string;
    name: string;
    slug: string;
    schema: unknown;
    projectName: string;
    sourceCount: number;
  }> = [];

  const allSources: Array<{
    id: string;
    name: string;
    slug: string;
    urlPattern: string | null;
    aiStatus: string | null;
    collectionName: string;
    projectSlug: string;
    collectionSlug: string;
  }> = [];

  for (const project of projects) {
    const collections = await api.collections.listByProject({ projectId: project.id });
    for (const col of collections) {
      allCollections.push({
        id: col.id,
        name: col.name,
        slug: col.slug,
        schema: col.schema,
        projectName: project.name,
        sourceCount: col.sourceCount,
      });

      const sources = await api.sources.listByCollection({ collectionId: col.id });
      for (const source of sources) {
        allSources.push({
          id: source.id,
          name: source.name,
          slug: source.slug,
          urlPattern: source.urlPattern,
          aiStatus: source.aiStatus,
          collectionName: col.name,
          projectSlug: project.slug,
          collectionSlug: col.slug,
        });
      }
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      {/* Breadcrumb */}
      <Link
        href="/scraper"
        className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition-colors"
      >
        <ArrowLeft className="size-3" />
        Customers
      </Link>

      {/* Header */}
      <div className="mt-3 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            {org.name}
          </h1>
          {org.description && (
            <p className="mt-1 text-sm text-slate-500">{org.description}</p>
          )}
        </div>
        <div className="flex gap-2">
          <Link href={`/scraper/${orgSlug}/new-source`}>
            <Button size="sm" className="gap-1.5 bg-slate-900 text-white hover:bg-slate-800">
              <Plus className="size-3.5" />
              New Source
            </Button>
          </Link>
        </div>
      </div>

      {/* Schemas Section */}
      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Database className="size-4 text-slate-400" />
            Schemas
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
              {allCollections.length}
            </span>
          </h2>
        </div>

        {allCollections.length === 0 ? (
          <div className="mt-3 rounded-xl border border-dashed border-slate-200 p-8 text-center">
            <p className="text-sm text-slate-500">No schemas defined yet. Schemas are created when you add your first source.</p>
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {allCollections.map((col) => {
              const fields = Array.isArray(col.schema) ? col.schema : [];
              return (
                <div
                  key={col.id}
                  className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between">
                    <h3 className="text-sm font-semibold text-slate-900">{col.name}</h3>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                      {fields.length} fields
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">{col.projectName}</p>
                  {fields.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {(fields as Array<{ name: string }>).slice(0, 5).map((f) => (
                        <span
                          key={f.name}
                          className="rounded bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-500 border border-slate-100"
                        >
                          {f.name}
                        </span>
                      ))}
                      {fields.length > 5 && (
                        <span className="text-[10px] text-slate-400">+{fields.length - 5}</span>
                      )}
                    </div>
                  )}
                  <div className="mt-3 text-xs text-slate-400">
                    {col.sourceCount} source{col.sourceCount !== 1 ? 's' : ''}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Sources Section */}
      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Globe className="size-4 text-slate-400" />
            Sources
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
              {allSources.length}
            </span>
          </h2>
        </div>

        {allSources.length === 0 ? (
          <div className="mt-3 rounded-xl border border-dashed border-slate-200 p-8 text-center">
            <p className="text-sm text-slate-500">No sources yet.</p>
            <Link href={`/scraper/${orgSlug}/new-source`} className="mt-3 inline-block">
              <Button size="sm" variant="outline" className="gap-1.5">
                <Plus className="size-3.5" />
                Add your first source
              </Button>
            </Link>
          </div>
        ) : (
          <div className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">
            {allSources.map((source) => (
              <Link
                key={source.id}
                href={`/scraper/${orgSlug}/sources/${source.id}`}
                className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-slate-50 first:rounded-t-xl last:rounded-b-xl"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-900 truncate">{source.name}</span>
                    <StatusBadge status={source.aiStatus} />
                  </div>
                  {source.urlPattern && (
                    <p className="mt-0.5 truncate font-mono text-xs text-slate-400">
                      {source.urlPattern}
                    </p>
                  )}
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    Schema: {source.collectionName}
                  </p>
                </div>
                <ChevronRight className="size-4 text-slate-300" />
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
