import { notFound } from 'next/navigation';
import { api } from '@/trpc/server';
import { ExtractorWorkspace } from '@/components/workspace';

export default async function ExtractorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [extractor, orgs, domains, recentRuns] = await Promise.all([
    api.extractors.getById({ id }),
    api.orgs.list(),
    api.domains.list(),
    api.runs.list({ extractorId: id }),
  ]);

  if (!extractor) {
    notFound();
  }

  // Load domain overrides (schemas, JS files, parameter defaults)
  const override = await api.overrides.getByDomainCountry({
    domainId: extractor.domainId,
    country: extractor.country,
  });

  const domainDefaults = (override?.parameterOverrides as Record<string, unknown>) ?? {};
  const schemas = (override?.schemas as Record<string, unknown>) ?? {};
  const jsOverrides = (override?.jsOverrides as Record<string, string>) ?? {};
  const schemaYAML = (extractor.parameters as Record<string, unknown>)?.schemaYAML as string | undefined;

  return (
    <ExtractorWorkspace
      extractor={extractor}
      orgs={orgs}
      domains={domains}
      domainDefaults={domainDefaults}
      schemas={schemas}
      jsOverrides={jsOverrides}
      schemaYAML={schemaYAML}
      overrideId={override?.id}
      hasGoto2={override?.hasGoto2 ?? false}
      hasBeforeExtract={override?.hasBeforeExtract ?? false}
      hasExtract={override?.hasExtract ?? false}
      hasTransform={override?.hasTransform ?? false}
      recentRuns={recentRuns}
    />
  );
}
