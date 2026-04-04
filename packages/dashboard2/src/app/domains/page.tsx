import { db, domainIntelligence } from '@robot/db';
import { desc } from 'drizzle-orm';
import { Globe, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { DomainActions } from './domain-actions';
import { DomainTable } from './domain-table';

export default async function DomainsPage() {
  const domains = await db
    .select()
    .from(domainIntelligence)
    .orderBy(desc(domainIntelligence.updatedAt));

  // Compute stats
  const totalDomains = domains.length;
  const healthyDomains = domains.filter(d => d.consecutiveFailures === 0).length;
  const degradedDomains = domains.filter(d => d.consecutiveFailures > 0 && d.consecutiveFailures < 5).length;
  const brokenDomains = domains.filter(d => d.consecutiveFailures >= 5).length;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Domain Library</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Global intelligence cache — what we know about each website
          </p>
        </div>
        <DomainActions />
      </div>

      {/* Stats */}
      <div className="mt-6 grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Globe className="size-4 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Total Domains</p>
            </div>
            <p className="mt-1 text-2xl font-bold">{totalDomains}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-emerald-500" />
              <p className="text-xs text-muted-foreground">Healthy</p>
            </div>
            <p className="mt-1 text-2xl font-bold text-emerald-600">{healthyDomains}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-amber-500" />
              <p className="text-xs text-muted-foreground">Degraded</p>
            </div>
            <p className="mt-1 text-2xl font-bold text-amber-600">{degradedDomains}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <XCircle className="size-4 text-red-500" />
              <p className="text-xs text-muted-foreground">Broken</p>
            </div>
            <p className="mt-1 text-2xl font-bold text-red-600">{brokenDomains}</p>
          </CardContent>
        </Card>
      </div>

      {/* Domain table with search + filters */}
      <DomainTable
        domains={domains.map(d => ({
          id: d.id,
          domain: d.domain,
          pageType: d.pageType,
          fieldPaths: (d.fieldPaths ?? {}) as Record<string, { paths: Array<{ source: string }>; conflictCount: number }>,
          hasJsonLd: d.hasJsonLd,
          totalRuns: d.totalRuns ?? 0,
          successfulRuns: d.successfulRuns ?? 0,
          consecutiveFailures: d.consecutiveFailures ?? 0,
          lastUsedAt: d.lastUsedAt.toISOString(),
        }))}
      />
    </div>
  );
}
