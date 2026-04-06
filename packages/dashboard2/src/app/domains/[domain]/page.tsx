import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Globe, CheckCircle2, AlertTriangle, XCircle, User, Bot, RefreshCw, Trash2, Clock } from 'lucide-react';
import { db, domainIntelligence } from '@robot/db';
import { eq } from 'drizzle-orm';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { DomainDetailActions } from './domain-detail-actions';

type FieldPath = {
  path: string;
  source: string;
  confidence: number;
  hits: number;
  misses: number;
  lastValue: unknown;
  lastUsedAt: string;
};

type FieldPathSet = {
  paths: FieldPath[];
  conflictCount: number;
};

export default async function DomainDetailPage({
  params,
}: {
  params: Promise<{ domain: string }>;
}) {
  const { domain: encodedDomain } = await params;
  const domainName = decodeURIComponent(encodedDomain);

  // Load all page type entries for this domain
  const entries = await db
    .select()
    .from(domainIntelligence)
    .where(eq(domainIntelligence.domain, domainName));

  if (entries.length === 0) notFound();

  // Find related domains (same brand, different TLD)
  function getBrand(d: string): string {
    const clean = d.replace(/^www\./, '');
    const parts = clean.split('.');
    const compoundTlds = ['co.uk', 'co.jp', 'co.kr', 'com.au', 'com.br', 'com.mx'];
    const suffix = parts.slice(-2).join('.');
    if (compoundTlds.includes(suffix) && parts.length >= 3) return parts[parts.length - 3];
    return parts.length >= 2 ? parts[parts.length - 2] : clean;
  }

  const brand = getBrand(domainName);
  const allDomains = await db
    .select({ domain: domainIntelligence.domain })
    .from(domainIntelligence);

  const uniqueRelated = [...new Set(
    allDomains
      .map(r => r.domain)
      .filter(d => d !== domainName && getBrand(d) === brand)
  )];

  // Aggregate stats across page types
  const totalRuns = entries.reduce((sum, e) => sum + (e.totalRuns ?? 0), 0);
  const successfulRuns = entries.reduce((sum, e) => sum + (e.successfulRuns ?? 0), 0);
  const successRate = totalRuns > 0 ? Math.round((successfulRuns / totalRuns) * 100) : 0;
  const maxConsecutiveFailures = Math.max(...entries.map(e => e.consecutiveFailures ?? 0));

  const health = maxConsecutiveFailures === 0
    ? { label: 'Healthy', icon: CheckCircle2, className: 'text-emerald-500' }
    : maxConsecutiveFailures < 5
    ? { label: `${maxConsecutiveFailures} failures`, icon: AlertTriangle, className: 'text-amber-500' }
    : { label: 'Broken', icon: XCircle, className: 'text-red-500' };

  return (
    <div className="mx-auto max-w-6xl">
      <Link
        href="/domains"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="size-3" />
        Domain Library
      </Link>

      {/* Header */}
      <div className="mt-3 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Globe className="size-5 text-muted-foreground" />
            <h1 className="text-xl font-bold tracking-tight">{domainName}</h1>
            <div className="flex items-center gap-1">
              <health.icon className={`size-4 ${health.className}`} />
              <span className="text-sm">{health.label}</span>
            </div>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {entries.length} page type{entries.length !== 1 ? 's' : ''} cached
          </p>
          {uniqueRelated.length > 0 && (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Related:</span>
              {uniqueRelated.map(d => (
                <Link key={d} href={`/domains/${encodeURIComponent(d)}`}>
                  <Badge variant="secondary" className="text-xs cursor-pointer hover:bg-primary/10">{d}</Badge>
                </Link>
              ))}
            </div>
          )}
        </div>
        <DomainDetailActions domain={domainName} />
      </div>

      {/* Stats */}
      <div className="mt-6 grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Runs</p>
            <p className="mt-1 text-2xl font-bold">{totalRuns}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Success Rate</p>
            <p className="mt-1 text-2xl font-bold">{successRate}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Page Types</p>
            <p className="mt-1 text-2xl font-bold">{entries.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Last Updated</p>
            <p className="mt-1 text-sm font-medium">
              {new Date(Math.max(...entries.map(e => new Date(e.updatedAt).getTime()))).toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric',
              })}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Page type sections */}
      {entries.map(entry => {
        const fieldPaths = (entry.fieldPaths ?? {}) as Record<string, FieldPathSet>;
        const fieldNames = Object.keys(fieldPaths);
        const apiEndpoints = (entry.apiEndpoints ?? []) as Array<{ url: string; method: string }>;

        return (
          <div key={entry.id} className="mt-8">
            <div className="flex items-center gap-2 mb-4">
              <Badge variant="secondary" className="text-xs uppercase">{entry.pageType}</Badge>
              <span className="text-sm text-muted-foreground">
                {fieldNames.length} fields · {entry.totalRuns ?? 0} runs
              </span>
              {entry.hasJsonLd && <Badge variant="secondary" className="text-[10px]">JSON-LD</Badge>}
              {entry.hasNextData && <Badge variant="secondary" className="text-[10px]">__NEXT_DATA__</Badge>}
            </div>

            <Tabs defaultValue="fields">
              <TabsList>
                <TabsTrigger value="fields">Fields ({fieldNames.length})</TabsTrigger>
                <TabsTrigger value="apis">APIs ({apiEndpoints.length})</TabsTrigger>
              </TabsList>

              {/* Fields Tab */}
              <TabsContent value="fields">
                {fieldNames.length > 0 ? (
                  <Card>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Field</TableHead>
                          <TableHead>Paths</TableHead>
                          <TableHead>Best Source</TableHead>
                          <TableHead>Hit Rate</TableHead>
                          <TableHead>Confidence</TableHead>
                          <TableHead>Last Value</TableHead>
                          <TableHead>Conflicts</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {fieldNames.map(fieldName => {
                          const pathSet = fieldPaths[fieldName];
                          const sortedPaths = [...pathSet.paths].sort((a, b) => {
                            if (a.source === 'human' && b.source !== 'human') return -1;
                            if (b.source === 'human' && a.source !== 'human') return 1;
                            const aRate = a.hits + a.misses > 0 ? a.hits / (a.hits + a.misses) : a.confidence;
                            const bRate = b.hits + b.misses > 0 ? b.hits / (b.hits + b.misses) : b.confidence;
                            return bRate - aRate;
                          });
                          const best = sortedPaths[0];
                          const hitRate = best && (best.hits + best.misses > 0)
                            ? Math.round((best.hits / (best.hits + best.misses)) * 100)
                            : null;

                          return (
                            <TableRow key={fieldName}>
                              <TableCell>
                                <span data-slot="mono" className="text-sm font-medium">{fieldName}</span>
                              </TableCell>
                              <TableCell>
                                <div className="space-y-0.5">
                                  {sortedPaths.map((p, i) => (
                                    <div key={i} className="flex items-center gap-1">
                                      {p.source === 'human' ? (
                                        <User className="size-2.5 text-blue-500" />
                                      ) : (
                                        <Bot className="size-2.5 text-muted-foreground" />
                                      )}
                                      <span data-slot="mono" className="truncate text-[10px] text-muted-foreground max-w-[200px]" title={p.path}>
                                        {p.path}
                                      </span>
                                      <Badge variant="secondary" className="text-[8px] shrink-0">{p.source}</Badge>
                                    </div>
                                  ))}
                                </div>
                              </TableCell>
                              <TableCell>
                                {best && (
                                  <Badge className={`text-[10px] ${
                                    best.source === 'human' ? 'bg-blue-100 text-blue-700' :
                                    best.source === 'api' || best.source === 'api-ai' ? 'bg-purple-100 text-purple-700' :
                                    'bg-muted text-muted-foreground'
                                  }`}>
                                    {best.source}
                                  </Badge>
                                )}
                              </TableCell>
                              <TableCell>
                                {hitRate !== null ? (
                                  <span className={`text-xs font-medium ${hitRate >= 80 ? 'text-emerald-600' : hitRate >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                                    {hitRate}%
                                  </span>
                                ) : (
                                  <span className="text-xs text-muted-foreground">—</span>
                                )}
                              </TableCell>
                              <TableCell>
                                {best ? (
                                  <span data-slot="mono" className="text-xs">{Math.round(best.confidence * 100)}%</span>
                                ) : '—'}
                              </TableCell>
                              <TableCell>
                                {best?.lastValue != null ? (
                                  <span data-slot="mono" className="text-xs truncate max-w-[150px] block" title={String(best.lastValue)}>
                                    {String(best.lastValue).slice(0, 50)}
                                  </span>
                                ) : (
                                  <span className="text-xs text-muted-foreground">—</span>
                                )}
                              </TableCell>
                              <TableCell>
                                {pathSet.conflictCount > 0 ? (
                                  <Badge className="bg-amber-100 text-amber-700 text-[10px]">
                                    {pathSet.conflictCount}
                                  </Badge>
                                ) : (
                                  <span className="text-xs text-muted-foreground">0</span>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </Card>
                ) : (
                  <Card className="border-dashed p-8 text-center">
                    <p className="text-sm text-muted-foreground">No fields cached for this page type.</p>
                  </Card>
                )}
              </TabsContent>

              {/* APIs Tab */}
              <TabsContent value="apis">
                {apiEndpoints.length > 0 ? (
                  <Card className="divide-y">
                    {apiEndpoints.map((api, i) => (
                      <div key={i} className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="text-[10px]">{api.method}</Badge>
                          <span data-slot="mono" className="text-xs text-muted-foreground truncate">{api.url}</span>
                        </div>
                      </div>
                    ))}
                  </Card>
                ) : (
                  <Card className="border-dashed p-8 text-center">
                    <p className="text-sm text-muted-foreground">No API endpoints captured for this page type.</p>
                  </Card>
                )}
              </TabsContent>
            </Tabs>
          </div>
        );
      })}
    </div>
  );
}
