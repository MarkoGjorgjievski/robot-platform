import { api } from "@/trpc/server";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { CollectionShell } from "./collection-shell";
import { createSource } from "./sources/actions";

export default async function CollectionLayout({
  params,
  children,
}: {
  params: Promise<{ orgSlug: string; projectSlug: string; collectionSlug: string }>;
  children: React.ReactNode;
}) {
  const { orgSlug, projectSlug, collectionSlug } = await params;

  const collection = await api.collections
    .getBySlug({ orgSlug, projectSlug, collectionSlug })
    .catch(() => null);
  if (!collection) notFound();

  const sourcesData = await api.sources
    .listByCollection({ collectionId: collection.id })
    .catch(() => []);

  const hasSchema = Array.isArray(collection.schema) && collection.schema.length > 0;
  const basePath = `/orgs/${orgSlug}/projects/${projectSlug}/collections/${collectionSlug}`;
  const sourcesBasePath = `${basePath}/sources`;

  const sources = sourcesData.map((s) => ({
    id: s.id,
    name: s.name,
    slug: s.slug,
    href: `${sourcesBasePath}/${s.slug}`,
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

  const header = (
    <>
      <Breadcrumbs
        items={[
          { label: "Organizations", href: "/orgs" },
          { label: orgSlug, href: `/orgs/${orgSlug}/projects` },
          { label: "Projects", href: `/orgs/${orgSlug}/projects` },
          { label: projectSlug, href: `/orgs/${orgSlug}/projects/${projectSlug}/collections` },
          { label: "Collections", href: `/orgs/${orgSlug}/projects/${projectSlug}/collections` },
          { label: collection.name },
        ]}
      />

      <div className="mb-4">
        <h1 className="text-lg font-semibold" style={{ color: "var(--ws-text)" }}>
          {collection.name}
        </h1>
        {collection.description && (
          <p className="mt-0.5 text-xs" style={{ color: "var(--ws-text-muted)" }}>
            {collection.description}
          </p>
        )}
      </div>
    </>
  );

  return (
    <CollectionShell
      sources={sources}
      collectionId={collection.id}
      basePath={basePath}
      hasSchema={hasSchema}
      onCreateSource={createSource}
      header={header}
    >
      {children}
    </CollectionShell>
  );
}
