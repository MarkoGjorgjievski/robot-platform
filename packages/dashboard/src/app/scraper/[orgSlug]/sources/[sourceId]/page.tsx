import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Database, Image, Settings, Table2 } from 'lucide-react';
import { SourceDetail } from './source-detail';

export default async function SourceDetailPage({
  params,
}: {
  params: Promise<{ orgSlug: string; sourceId: string }>;
}) {
  const { orgSlug, sourceId } = await params;

  // For now, pass the IDs to the client component
  // In a real implementation, we'd fetch the source data here
  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href={`/scraper/${orgSlug}`}
        className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition-colors"
      >
        <ArrowLeft className="size-3" />
        Back to customer
      </Link>

      <SourceDetail orgSlug={orgSlug} sourceId={sourceId} />
    </div>
  );
}
