import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ExternalLink, Play, Download, Clock, CheckCircle2, XCircle, Globe } from 'lucide-react';
import { db, sources, collections, extractions, captures, orgs, projects } from '@robot/db';
import { eq, desc, and } from 'drizzle-orm';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { SourceActions } from './source-actions';
import { SchemaEditor } from './schema-editor';

export default async function SourceDetailPage({
  params,
}: {
  params: Promise<{ orgSlug: string; sourceId: string }>;
}) {
  const { orgSlug, sourceId } = await params;

  // Load source with collection (schema) and org
  const source = await db.query.sources.findFirst({
    where: eq(sources.id, sourceId),
    with: {
      collection: true,
      captures: {
        orderBy: [desc(captures.createdAt)],
        limit: 10,
      },
      extractions: {
        orderBy: [desc(extractions.createdAt)],
        limit: 50,
      },
    },
  });

  if (!source) notFound();

  const org = await db.query.orgs.findFirst({
    where: eq(orgs.slug, orgSlug),
  });

  if (!org) notFound();

  const schema = (source.collection.schema ?? []) as Array<{
    name: string;
    type: string;
    description?: string;
    required?: boolean;
  }>;

  const domain = source.urlPattern ? new URL(source.urlPattern).hostname : null;

  // Get the latest extraction data
  const latestExtraction = source.extractions[0];
  const extractionData = (latestExtraction?.data ?? []) as Record<string, unknown>[];

  const statusConfig = {
    ready: { label: 'Ready', className: 'bg-emerald-100 text-emerald-700' },
    pending: { label: 'Pending', className: 'bg-amber-100 text-amber-700' },
    failed: { label: 'Failed', className: 'bg-red-100 text-red-700' },
  } as const;

  const status = statusConfig[(source.aiStatus as keyof typeof statusConfig) ?? 'pending'] ?? statusConfig.pending;

  return (
    <div className="mx-auto max-w-6xl">
      {/* Breadcrumb */}
      <Link
        href={`/scraper/${orgSlug}`}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="size-3" />
        {org.name}
      </Link>

      {/* Header */}
      <div className="mt-3 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold tracking-tight">{source.name}</h1>
            <Badge className={`text-[10px] ${status.className}`}>{status.label}</Badge>
            <Badge variant="secondary" className="text-[10px] uppercase">{source.sourceType ?? 'detail'}</Badge>
          </div>
          {source.urlPattern && (
            <a
              href={source.urlPattern}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Globe className="size-3" />
              {domain}
              <ExternalLink className="size-2.5" />
            </a>
          )}
        </div>

        <SourceActions sourceId={sourceId} url={source.urlPattern ?? ''} orgSlug={orgSlug} />
      </div>

      {/* Stats */}
      <div className="mt-6 grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Fields</p>
            <p className="mt-1 text-2xl font-bold">{schema.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Extractions</p>
            <p className="mt-1 text-2xl font-bold">{source.extractions.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Confidence</p>
            <p className="mt-1 text-2xl font-bold">
              {latestExtraction?.confidence != null ? `${latestExtraction.confidence}%` : '—'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Last Run</p>
            <p className="mt-1 text-sm font-medium">
              {latestExtraction?.createdAt
                ? new Date(latestExtraction.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                : '—'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="data" className="mt-6">
        <TabsList>
          <TabsTrigger value="data">Data</TabsTrigger>
          <TabsTrigger value="schema">Schema ({schema.length})</TabsTrigger>
          <TabsTrigger value="runs">Runs ({source.extractions.length})</TabsTrigger>
        </TabsList>

        {/* Data Tab */}
        <TabsContent value="data">
          {extractionData.length > 0 ? (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    {schema.map(f => (
                      <TableHead key={f.name} className="text-xs">{f.name}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {extractionData.slice(0, 50).map((row, i) => (
                    <TableRow key={i}>
                      <TableCell data-slot="mono" className="text-xs text-muted-foreground">{i + 1}</TableCell>
                      {schema.map(f => (
                        <TableCell key={f.name} className="max-w-[200px] truncate text-xs" data-slot="mono">
                          {row[f.name] != null
                            ? String(row[f.name]).slice(0, 100)
                            : <span className="text-muted-foreground/40">—</span>
                          }
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {extractionData.length > 50 && (
                <div className="border-t p-3 text-xs text-muted-foreground">
                  Showing 50 of {extractionData.length} rows
                </div>
              )}
            </Card>
          ) : (
            <Card className="border-dashed p-12 text-center">
              <p className="text-sm text-muted-foreground">
                No extraction data yet. Click "Run Extraction" to extract data from this source.
              </p>
            </Card>
          )}
        </TabsContent>

        {/* Schema Tab */}
        <TabsContent value="schema">
          <SchemaEditor
            sourceId={sourceId}
            domain={domain ?? ''}
            pageType={source.sourceType ?? 'detail'}
            url={source.urlPattern ?? ''}
            initialFields={schema}
            selectorsJson={source.selectorsJson}
            extractedData={extractionData[0]}
          />
        </TabsContent>

        {/* Runs Tab */}
        <TabsContent value="runs">
          {source.extractions.length > 0 ? (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Rows</TableHead>
                    <TableHead>Confidence</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {source.extractions.map((ext) => (
                    <TableRow key={ext.id}>
                      <TableCell className="text-xs">
                        <div className="flex items-center gap-1.5">
                          <Clock className="size-3 text-muted-foreground" />
                          {new Date(ext.createdAt).toLocaleDateString('en-US', {
                            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                          })}
                        </div>
                      </TableCell>
                      <TableCell data-slot="mono" className="text-xs">{ext.rowCount ?? 0}</TableCell>
                      <TableCell>
                        {ext.confidence != null ? (
                          <Badge className={`text-[10px] ${ext.confidence >= 80 ? 'bg-emerald-100 text-emerald-700' : ext.confidence >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                            {ext.confidence}%
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <CheckCircle2 className="size-3 text-emerald-500" />
                          <span className="text-xs">Complete</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          ) : (
            <Card className="border-dashed p-12 text-center">
              <p className="text-sm text-muted-foreground">No runs yet.</p>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
