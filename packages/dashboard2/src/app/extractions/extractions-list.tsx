'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Globe } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';

type Extraction = {
  id: string;
  url: string;
  domain: string;
  extractedData: unknown;
  fields: unknown;
  confidence: number | null;
  sources: unknown;
  createdAt: Date;
};

type Props = {
  domains: [string, Extraction[]][];
};

export function ExtractionsList({ domains }: Props) {
  const [expandedDomain, setExpandedDomain] = useState<string | null>(
    domains.length > 0 ? domains[0][0] : null
  );
  const [expandedExtraction, setExpandedExtraction] = useState<string | null>(null);

  if (domains.length === 0) {
    return (
      <Card className="mt-8 border-dashed p-12 text-center">
        <p className="text-sm text-muted-foreground">No extractions yet. Go extract something!</p>
      </Card>
    );
  }

  return (
    <div className="mt-6 space-y-3">
      {domains.map(([domain, extractions]) => (
        <Card key={domain}>
          {/* Domain header */}
          <button
            onClick={() => setExpandedDomain(expandedDomain === domain ? null : domain)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
          >
            {expandedDomain === domain ? (
              <ChevronDown className="size-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-4 text-muted-foreground" />
            )}
            <Globe className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium">{domain}</span>
            <Badge variant="secondary" className="text-[10px]">
              {extractions.length}
            </Badge>
            <span className="ml-auto text-[11px] text-muted-foreground">
              {formatDate(extractions[0].createdAt)}
            </span>
          </button>

          {/* Extraction rows */}
          {expandedDomain === domain && (
            <div className="border-t divide-y">
              {extractions.map(extraction => {
                const fields = Array.isArray(extraction.fields) ? extraction.fields : [];
                const data = Array.isArray(extraction.extractedData) ? extraction.extractedData : [];
                const path = (() => { try { return new URL(extraction.url).pathname; } catch { return extraction.url; } })();
                const isExpanded = expandedExtraction === extraction.id;

                return (
                  <div key={extraction.id}>
                    <button
                      onClick={() => setExpandedExtraction(isExpanded ? null : extraction.id)}
                      className="flex w-full items-center gap-3 px-4 py-2.5 pl-12 text-left transition-colors hover:bg-muted/50"
                    >
                      {isExpanded ? (
                        <ChevronDown className="size-3.5 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="size-3.5 text-muted-foreground" />
                      )}
                      <span data-slot="mono" className="text-xs text-muted-foreground truncate flex-1">
                        {path}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {fields.length} fields
                      </span>
                      {extraction.confidence != null && (
                        <Badge
                          variant="secondary"
                          className={`text-[10px] ${
                            extraction.confidence > 80 ? 'text-emerald-600' :
                            extraction.confidence > 50 ? 'text-amber-600' : 'text-red-600'
                          }`}
                        >
                          {extraction.confidence}%
                        </Badge>
                      )}
                      <span className="text-[11px] text-muted-foreground">
                        {formatDate(extraction.createdAt)}
                      </span>
                    </button>

                    {/* Inline data table */}
                    {isExpanded && data.length > 0 && (
                      <div className="border-t bg-muted/30 px-4 py-3 pl-12">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              {Object.keys(data[0] as Record<string, unknown>).map(key => (
                                <TableHead key={key} className="text-[11px]">{key}</TableHead>
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {(data as Record<string, unknown>[]).slice(0, 10).map((row, i) => (
                              <TableRow key={i}>
                                {Object.values(row).map((val, j) => (
                                  <TableCell key={j} data-slot="mono" className="max-w-[200px] truncate text-xs">
                                    {val != null ? String(val) : <span className="text-muted-foreground/40">—</span>}
                                  </TableCell>
                                ))}
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                        {data.length > 10 && (
                          <p className="mt-2 text-[11px] text-muted-foreground">
                            Showing 10 of {data.length} rows
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function formatDate(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
