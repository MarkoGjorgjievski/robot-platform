import Link from 'next/link';
import { notFound } from 'next/navigation';
import { api } from '@/trpc/server';
import { Plus, ArrowLeft, Database, Globe, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/status-badge';

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

  const allCollections: Array<{
    id: string;
    name: string;
    schema: unknown;
    projectName: string;
    sourceCount: number;
  }> = [];

  const allSources: Array<{
    id: string;
    name: string;
    urlPattern: string | null;
    aiStatus: string | null;
    collectionName: string;
  }> = [];

  for (const project of projects) {
    const collections = await api.collections.listByProject({ projectId: project.id });
    for (const col of collections) {
      allCollections.push({
        id: col.id,
        name: col.name,
        schema: col.schema,
        projectName: project.name,
        sourceCount: col.sourceCount,
      });

      const sources = await api.sources.listByCollection({ collectionId: col.id });
      for (const source of sources) {
        allSources.push({
          id: source.id,
          name: source.name,
          urlPattern: source.urlPattern,
          aiStatus: source.aiStatus,
          collectionName: col.name,
        });
      }
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="size-3" />
        Customers
      </Link>

      <div className="mt-3 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{org.name}</h1>
          {org.description && (
            <p className="mt-1 text-sm text-muted-foreground">{org.description}</p>
          )}
        </div>
        <Link href={`/scraper/${orgSlug}/new-source`}>
          <Button size="sm" className="gap-1.5">
            <Plus className="size-3.5" />
            New Source
          </Button>
        </Link>
      </div>

      {/* Schemas */}
      <section className="mt-8">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Database className="size-4 text-muted-foreground" />
          Schemas
          <Badge variant="secondary" className="text-[10px]">{allCollections.length}</Badge>
        </h2>

        {allCollections.length === 0 ? (
          <Card className="mt-3 border-dashed p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No schemas yet. They are created when you add a source.
            </p>
          </Card>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {allCollections.map((col) => {
              const fields = Array.isArray(col.schema) ? col.schema : [];
              return (
                <Card key={col.id}>
                  <CardHeader className="pb-0">
                    <div className="flex items-start justify-between">
                      <CardTitle>{col.name}</CardTitle>
                      <Badge variant="secondary" className="text-[10px]">
                        {fields.length} fields
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{col.projectName}</p>
                  </CardHeader>
                  <CardContent className="pt-3">
                    {fields.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {(fields as Array<{ name: string }>).slice(0, 5).map((f) => (
                          <span
                            key={f.name}
                            data-slot="mono"
                            className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground border"
                          >
                            {f.name}
                          </span>
                        ))}
                        {fields.length > 5 && (
                          <span className="text-[10px] text-muted-foreground">+{fields.length - 5}</span>
                        )}
                      </div>
                    )}
                    <p className="mt-3 text-xs text-muted-foreground">
                      {col.sourceCount} source{col.sourceCount !== 1 ? 's' : ''}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* Sources */}
      <section className="mt-8">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Globe className="size-4 text-muted-foreground" />
          Sources
          <Badge variant="secondary" className="text-[10px]">{allSources.length}</Badge>
        </h2>

        {allSources.length === 0 ? (
          <Card className="mt-3 border-dashed p-8 text-center">
            <p className="text-sm text-muted-foreground">No sources yet.</p>
            <Link href={`/scraper/${orgSlug}/new-source`} className="mt-3 inline-block">
              <Button size="sm" variant="outline" className="gap-1.5">
                <Plus className="size-3.5" />
                Add your first source
              </Button>
            </Link>
          </Card>
        ) : (
          <Card className="mt-3 divide-y">
            {allSources.map((source) => (
              <Link
                key={source.id}
                href={`/scraper/${orgSlug}/sources/${source.id}`}
                className="flex items-center justify-between px-5 py-3.5 transition-colors hover:bg-muted/50 first:rounded-t-xl last:rounded-b-xl"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{source.name}</span>
                    <StatusBadge status={source.aiStatus} />
                  </div>
                  {source.urlPattern && (
                    <p data-slot="mono" className="mt-0.5 truncate text-xs text-muted-foreground">
                      {source.urlPattern}
                    </p>
                  )}
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Schema: {source.collectionName}
                  </p>
                </div>
                <ChevronRight className="size-4 text-muted-foreground/50" />
              </Link>
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}
