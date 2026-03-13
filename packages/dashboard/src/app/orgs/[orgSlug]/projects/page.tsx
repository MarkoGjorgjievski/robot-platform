import { api } from '@/trpc/server';
import { FolderGlossary } from '@/components/folder-glossary';
import { notFound } from 'next/navigation';
import { CreateProjectForm } from './create-form';

export default async function ProjectsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  const orgs = await api.orgs.list();
  const org = orgs.find((o) => o.slug === orgSlug);
  if (!org) notFound();

  const projects = await api.projects.listByOrg({ orgId: org.id }).catch(() => []);

  const items = projects.map((p) => ({
    name: p.name,
    href: `/orgs/${orgSlug}/projects/${p.slug}/collections`,
    count: p.collectionCount,
    description: p.description,
  }));

  return (
    <FolderGlossary
      title={`${org.name} — Projects`}
      description="Select a project to browse its collections."
      items={items}
      breadcrumbs={[
        { label: "Organizations", href: "/orgs" },
        { label: org.name, href: `/orgs/${orgSlug}/projects` },
        { label: "Projects" },
      ]}
    >
      <CreateProjectForm
        orgId={org.id}
        existingNames={projects.map((p) => p.name)}
      />
    </FolderGlossary>
  );
}
