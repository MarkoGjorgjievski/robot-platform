import { NextResponse } from 'next/server';
import { api } from '@/trpc/server';
import { exportExtractorYAML, exportInputsYAML, exportCredentialsYAML } from '@robot/config';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const extractor = await api.extractors.getById({ id });
  if (!extractor) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const extractorYaml = exportExtractorYAML({
    robotTemplate: extractor.robotTemplate,
    country: extractor.country,
    domainName: extractor.domain.name,
    variant: extractor.variant,
    parameters: extractor.parameters as Record<string, unknown>,
    inputs: extractor.inputs.map((i) => ({
      label: i.label,
      inputData: i.inputData as Record<string, unknown>,
    })),
    credentials: extractor.credentials.map((c) => ({
      environment: c.environment,
      username: c.username,
      password: c.password,
      extraFields: c.extraFields,
    })),
  });

  const inputsYaml = exportInputsYAML(
    extractor.inputs.map((i) => ({
      label: i.label,
      inputData: i.inputData as Record<string, unknown>,
    })),
  );

  const credentialsYaml = exportCredentialsYAML(
    extractor.credentials.map((c) => ({
      environment: c.environment,
      username: c.username,
      password: c.password,
      extraFields: c.extraFields,
    })),
  );

  const result = [
    '# extractor.yaml',
    extractorYaml,
    inputsYaml ? `# inputs.yaml\n${inputsYaml}` : '',
    credentialsYaml ? `# credentials.yaml\n${credentialsYaml}` : '',
  ]
    .filter(Boolean)
    .join('\n---\n\n');

  return new NextResponse(result, {
    headers: {
      'Content-Type': 'text/yaml',
      'Content-Disposition': `attachment; filename="${extractor.domain.name}-${extractor.country}-${extractor.variant}.yaml"`,
    },
  });
}
