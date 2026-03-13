import { api } from "@/trpc/server";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { CollectionTabs } from "./collection-tabs";

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

  const hasSchema = Array.isArray(collection.schema) && collection.schema.length > 0;
  const basePath = `/orgs/${orgSlug}/projects/${projectSlug}/collections/${collectionSlug}`;

  return (
    <div>
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

      <CollectionTabs basePath={basePath} hasSchema={hasSchema} />

      {children}
    </div>
  );
}
