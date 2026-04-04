'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { Globe, CheckCircle2, AlertTriangle, XCircle, User, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';

type DomainEntry = {
  id: string;
  domain: string;
  pageType: string;
  fieldPaths: Record<string, { paths: Array<{ source: string }>; conflictCount: number }>;
  hasJsonLd: boolean;
  totalRuns: number;
  successfulRuns: number;
  consecutiveFailures: number;
  lastUsedAt: string;
};

type HealthFilter = 'all' | 'healthy' | 'degraded' | 'broken';
type SourceFilter = 'all' | 'api' | 'xpath' | 'human' | 'jsonld';

export function DomainTable({ domains }: { domains: DomainEntry[] }) {
  const [search, setSearch] = useState('');
  const [healthFilter, setHealthFilter] = useState<HealthFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  // Extract brand from domain
  function getBrand(domain: string): string {
    const clean = domain.replace(/^www\./, '');
    const parts = clean.split('.');
    const compoundTlds = ['co.uk', 'co.jp', 'co.kr', 'co.nz', 'com.au', 'com.br', 'com.mx', 'org.uk'];
    const suffix = parts.slice(-2).join('.');
    if (compoundTlds.includes(suffix) && parts.length >= 3) return parts[parts.length - 3];
    return parts.length >= 2 ? parts[parts.length - 2] : clean;
  }

  // Group domains by brand
  const brandGroups = useMemo(() => {
    const groups: Record<string, { brand: string; domains: string[] }> = {};
    for (const d of domains) {
      const brand = getBrand(d.domain);
      if (!groups[brand]) groups[brand] = { brand, domains: [] };
      if (!groups[brand].domains.includes(d.domain)) {
        groups[brand].domains.push(d.domain);
      }
    }
    return groups;
  }, [domains]);

  const filtered = useMemo(() => {
    return domains.filter(d => {
      // Search
      if (search && !d.domain.toLowerCase().includes(search.toLowerCase())) return false;

      // Health
      if (healthFilter === 'healthy' && d.consecutiveFailures > 0) return false;
      if (healthFilter === 'degraded' && (d.consecutiveFailures === 0 || d.consecutiveFailures >= 5)) return false;
      if (healthFilter === 'broken' && d.consecutiveFailures < 5) return false;

      // Source
      if (sourceFilter !== 'all') {
        const sources = new Set<string>();
        for (const fp of Object.values(d.fieldPaths)) {
          for (const p of fp.paths ?? []) sources.add(p.source);
        }
        if (sourceFilter === 'api' && !sources.has('api') && !sources.has('api-ai')) return false;
        if (sourceFilter === 'xpath' && !sources.has('xpath') && !sources.has('xpath-cached')) return false;
        if (sourceFilter === 'human' && !sources.has('human')) return false;
        if (sourceFilter === 'jsonld' && !d.hasJsonLd) return false;
      }

      // Type
      if (typeFilter !== 'all' && d.pageType !== typeFilter) return false;

      return true;
    });
  }, [domains, search, healthFilter, sourceFilter, typeFilter]);

  const pageTypes = [...new Set(domains.map(d => d.pageType))];

  return (
    <div>
      {/* Search + Filters */}
      <div className="mt-6 flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search domains..."
            className="h-9 pl-9"
          />
        </div>

        <FilterButtons
          label="Health"
          value={healthFilter}
          onChange={(v) => setHealthFilter(v as HealthFilter)}
          options={[
            { value: 'all', label: 'All' },
            { value: 'healthy', label: 'Healthy' },
            { value: 'degraded', label: 'Degraded' },
            { value: 'broken', label: 'Broken' },
          ]}
        />

        <FilterButtons
          label="Source"
          value={sourceFilter}
          onChange={(v) => setSourceFilter(v as SourceFilter)}
          options={[
            { value: 'all', label: 'All' },
            { value: 'api', label: 'API' },
            { value: 'xpath', label: 'XPath' },
            { value: 'human', label: 'Manual' },
            { value: 'jsonld', label: 'JSON-LD' },
          ]}
        />

        {pageTypes.length > 1 && (
          <FilterButtons
            label="Type"
            value={typeFilter}
            onChange={setTypeFilter}
            options={[
              { value: 'all', label: 'All' },
              ...pageTypes.map(t => ({ value: t, label: t })),
            ]}
          />
        )}
      </div>

      {/* Results count */}
      <p className="mt-3 text-xs text-muted-foreground">
        {filtered.length} of {domains.length} domains
      </p>

      {/* Table */}
      {filtered.length > 0 ? (
        <Card className="mt-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Domain</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Fields</TableHead>
                <TableHead>Sources</TableHead>
                <TableHead>Runs</TableHead>
                <TableHead>Success</TableHead>
                <TableHead>Health</TableHead>
                <TableHead>Last Used</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(domain => {
                const fieldCount = Object.keys(domain.fieldPaths).length;
                const humanFieldCount = Object.values(domain.fieldPaths).filter(fp =>
                  fp.paths?.some(p => p.source === 'human')
                ).length;

                const successRate = domain.totalRuns > 0
                  ? Math.round((domain.successfulRuns / domain.totalRuns) * 100)
                  : 0;

                const sourceTypes = new Set<string>();
                for (const fp of Object.values(domain.fieldPaths)) {
                  for (const p of fp.paths ?? []) sourceTypes.add(p.source);
                }

                const health = domain.consecutiveFailures === 0
                  ? { label: 'Healthy', icon: CheckCircle2, className: 'text-emerald-500' }
                  : domain.consecutiveFailures < 5
                  ? { label: `${domain.consecutiveFailures} fails`, icon: AlertTriangle, className: 'text-amber-500' }
                  : { label: 'Broken', icon: XCircle, className: 'text-red-500' };

                return (
                  <TableRow key={domain.id} className="cursor-pointer">
                    <TableCell>
                      <Link href={`/domains/${encodeURIComponent(domain.domain)}`} className="flex items-center gap-2 hover:underline">
                        <Globe className="size-3.5 text-muted-foreground" />
                        <span className="text-sm font-medium">{domain.domain}</span>
                      </Link>
                      {(() => {
                        const brand = getBrand(domain.domain);
                        const group = brandGroups[brand];
                        if (group && group.domains.length > 1) {
                          const otherDomains = group.domains.filter(d => d !== domain.domain);
                          return (
                            <div className="mt-0.5 flex gap-1">
                              {otherDomains.slice(0, 3).map(d => {
                                const tld = d.replace(/^.*?\./, '.');
                                return (
                                  <Link key={d} href={`/domains/${encodeURIComponent(d)}`}>
                                    <Badge variant="secondary" className="text-[8px] cursor-pointer hover:bg-primary/10">{tld}</Badge>
                                  </Link>
                                );
                              })}
                              {otherDomains.length > 3 && (
                                <Badge variant="secondary" className="text-[8px]">+{otherDomains.length - 3}</Badge>
                              )}
                            </div>
                          );
                        }
                        return null;
                      })()}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-[10px] uppercase">{domain.pageType}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <span data-slot="mono" className="text-xs">{fieldCount}</span>
                        {humanFieldCount > 0 && (
                          <Badge className="bg-blue-100 text-blue-700 text-[10px] gap-0.5">
                            <User className="size-2" />{humanFieldCount}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {(sourceTypes.has('api') || sourceTypes.has('api-ai')) && <Badge variant="secondary" className="text-[9px]">API</Badge>}
                        {(sourceTypes.has('xpath') || sourceTypes.has('xpath-cached')) && <Badge variant="secondary" className="text-[9px]">XPath</Badge>}
                        {sourceTypes.has('human') && <Badge className="bg-blue-100 text-blue-700 text-[9px]">Manual</Badge>}
                        {domain.hasJsonLd && <Badge variant="secondary" className="text-[9px]">LD</Badge>}
                      </div>
                    </TableCell>
                    <TableCell data-slot="mono" className="text-xs">{domain.totalRuns}</TableCell>
                    <TableCell>
                      {domain.totalRuns > 0 ? (
                        <Badge className={`text-[10px] ${
                          successRate >= 80 ? 'bg-emerald-100 text-emerald-700' :
                          successRate >= 50 ? 'bg-amber-100 text-amber-700' :
                          'bg-red-100 text-red-700'
                        }`}>{successRate}%</Badge>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <health.icon className={`size-3.5 ${health.className}`} />
                        <span className="text-xs">{health.label}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(domain.lastUsedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      ) : (
        <Card className="mt-3 border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            {domains.length === 0 ? 'No domains cached yet.' : 'No domains match your filters.'}
          </p>
        </Card>
      )}
    </div>
  );
}

function FilterButtons({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-medium text-muted-foreground uppercase">{label}</span>
      <div className="flex rounded-lg border overflow-hidden">
        {options.map(opt => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`px-2.5 py-1 text-[10px] font-medium transition-colors border-r last:border-r-0 ${
              value === opt.value
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
