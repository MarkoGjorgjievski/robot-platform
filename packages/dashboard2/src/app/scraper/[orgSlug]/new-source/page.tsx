import { notFound } from 'next/navigation';
import { api } from '@/trpc/server';
import { NewSourceWizard } from './wizard';

export default async function NewSourcePage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  let org;
  try {
    org = await api.orgs.getBySlug({ slug: orgSlug });
  } catch {
    notFound();
  }

  const projects = await api.projects.listByOrg({ orgId: org.id });
  const schemas: Array<{ id: string; name: string; fields: Array<{ name: string; type: string }> }> = [];

  for (const project of projects) {
    const collections = await api.collections.listByProject({ projectId: project.id });
    for (const col of collections) {
      const fields = Array.isArray(col.schema) ? (col.schema as Array<{ name: string; type: string }>) : [];
      schemas.push({ id: col.id, name: col.name, fields });
    }
  }

  return (
    <NewSourceWizard
      orgSlug={orgSlug}
      orgId={org.id}
      orgName={org.name}
      existingSchemas={schemas}
    />
  );
}
