'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Table2, Database, Image, Settings } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

export default function SourceDetailPage() {
  const params = useParams<{ orgSlug: string; sourceId: string }>();

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href={`/scraper/${params.orgSlug}`}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="size-3" />
        Back to customer
      </Link>

      <div className="mt-3">
        <h1 className="text-xl font-bold tracking-tight">Source Detail</h1>
        <p data-slot="mono" className="mt-1 text-xs text-muted-foreground">{params.sourceId}</p>
      </div>

      <Tabs defaultValue="data" className="mt-6">
        <TabsList>
          <TabsTrigger value="data">
            <Table2 className="size-3.5" />
            Data
          </TabsTrigger>
          <TabsTrigger value="schema">
            <Database className="size-3.5" />
            Schema
          </TabsTrigger>
          <TabsTrigger value="captures">
            <Image className="size-3.5" />
            Captures
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Settings className="size-3.5" />
            Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="data">
          <Card className="border-dashed p-12 text-center">
            <Table2 className="mx-auto size-8 text-muted-foreground/30" />
            <p className="mt-3 text-sm text-muted-foreground">
              No extraction data yet. Run an extraction from the Captures tab.
            </p>
          </Card>
        </TabsContent>

        <TabsContent value="schema">
          <Card className="border-dashed p-12 text-center">
            <Database className="mx-auto size-8 text-muted-foreground/30" />
            <p className="mt-3 text-sm text-muted-foreground">Schema editor coming soon.</p>
          </Card>
        </TabsContent>

        <TabsContent value="captures">
          <Card className="border-dashed p-12 text-center">
            <Image className="mx-auto size-8 text-muted-foreground/30" />
            <p className="mt-3 text-sm text-muted-foreground">No captures yet.</p>
          </Card>
        </TabsContent>

        <TabsContent value="settings">
          <Card className="border-dashed p-12 text-center">
            <Settings className="mx-auto size-8 text-muted-foreground/30" />
            <p className="mt-3 text-sm text-muted-foreground">Source settings coming soon.</p>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
