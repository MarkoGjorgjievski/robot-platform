import { api } from '@/trpc/server';
import { notFound } from 'next/navigation';
import { SourcesLayout } from './sources-layout';
import { createSource } from './actions';

export default async function SourcesPage({
  params,
}: {
  params: Promise<{ orgSlug: string; projectSlug: string; collectionSlug: string }>;
}) {
  const { orgSlug, projectSlug, collectionSlug } = await params;

  const collection = await api.collections
    .getBySlug({ orgSlug, projectSlug, collectionSlug })
    .catch(() => null);
  if (!collection) notFound();

  const sources = await api.sources.listByCollection({ collectionId: collection.id }).catch(() => []);

  const basePath = `/orgs/${orgSlug}/projects/${projectSlug}/collections/${collectionSlug}/sources`;

  const items = sources.map((s) => ({
    id: s.id,
    name: s.name,
    slug: s.slug,
    href: `${basePath}/${s.slug}`,
    country: s.country,
    locale: s.locale,
    currency: s.currency,
    domain: s.domain,
    dataCenter: s.dataCenter,
    proxyType: s.proxyType,
    loginPool: s.loginPool,
    maximumInputs: s.maximumInputs,
    isActive: s.isActive,
    updatedAt: s.updatedAt,
  }));

  return (
    <SourcesLayout
      items={items}
      collectionId={collection.id}
      onSubmit={createSource}
    />
  );
}
