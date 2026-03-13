import { notFound } from 'next/navigation';
import { api } from '@/trpc/server';
import { ExtractorWorkspace } from '@/components/workspace';

export default async function SourceDetailPage({
  params,
}: {
  params: Promise<{
    orgSlug: string;
    projectSlug: string;
    collectionSlug: string;
    sourceSlug: string;
  }>;
}) {
  const { orgSlug, projectSlug, collectionSlug, sourceSlug } = await params;

  const [source, orgs, allDomains] = await Promise.all([
    api.sources.getBySlug({ orgSlug, projectSlug, collectionSlug, sourceSlug }).catch(() => null),
    api.orgs.list(),
    api.domains.list(),
  ]);

  if (!source) notFound();

  // Load domain overrides if source has a domainId
  const override = source.domainId
    ? await api.overrides.getByDomainCountry({
        domainId: source.domainId,
        country: source.country,
      }).catch(() => null)
    : null;

  const domainDefaults = (override?.parameterOverrides as Record<string, unknown>) ?? {};
  const overrideSchemas = (override?.schemas as Record<string, unknown>) ?? {};
  const jsOverrides = (override?.jsOverrides as Record<string, string>) ?? {};
  const schemaYAML = (source.parameters as Record<string, unknown>)?.schemaYAML as string | undefined;

  // Use override schemas if available, otherwise expose the collection schema
  const collectionSchemaObj = source.collectionSchema
    ? { [source.collectionName ?? 'schema']: source.collectionSchema }
    : {};
  const schemas = Object.keys(overrideSchemas).length > 0 ? overrideSchemas : collectionSchemaObj;

  // Map source to the extractor shape expected by ExtractorWorkspace
  const extractor = {
    id: source.id,
    orgId: source.orgId,
    domainId: source.domainId ?? '',
    country: source.country,
    variant: source.variant,
    robotTemplate: source.robotTemplate,
    parameters: source.parameters,
    isActive: source.isActive,
    org: { name: source.orgName },
    domain: { name: source.domainName ?? 'unknown' },
    inputs: [] as { id: string; label: string; inputData: unknown; createdAt: Date }[],
    credentials: [] as { id: string; environment: string; username: string | null; createdAt: Date }[],
  };

  return (
    <ExtractorWorkspace
      extractor={extractor}
      orgs={orgs}
      domains={allDomains}
      domainDefaults={domainDefaults}
      schemas={schemas}
      jsOverrides={jsOverrides}
      schemaYAML={schemaYAML}
      overrideId={override?.id}
      hasGoto2={override?.hasGoto2 ?? false}
      hasBeforeExtract={override?.hasBeforeExtract ?? false}
      hasExtract={override?.hasExtract ?? false}
      hasTransform={override?.hasTransform ?? false}
      recentRuns={[]}
    />
  );
}
