import { stringify as toYAML } from 'yaml';

type ExtractorData = {
  robotTemplate: string;
  country: string;
  domainName: string;
  variant: string;
  parameters: Record<string, unknown>;
  inputs: Array<{ label: string; inputData: Record<string, unknown> }>;
  credentials: Array<{
    environment: string;
    username?: string | null;
    password?: string | null;
    extraFields?: unknown;
  }>;
};

export function exportExtractorYAML(data: ExtractorData): string {
  const extractor: Record<string, unknown> = {
    robot: data.robotTemplate,
    parameters: {
      country: data.country,
      domain: data.domainName,
      schemaYAML: data.variant,
      ...data.parameters,
    },
  };

  return toYAML(extractor, { lineWidth: 0 });
}

export function exportInputsYAML(inputs: ExtractorData['inputs']): string {
  if (inputs.length === 0) return '';

  const inputMap: Record<string, unknown> = {};
  for (const input of inputs) {
    inputMap[input.label] = input.inputData;
  }

  return toYAML(inputMap, { lineWidth: 0 });
}

export function exportCredentialsYAML(credentials: ExtractorData['credentials']): string {
  if (credentials.length === 0) return '';

  const defaultCred = credentials.find((c) => c.environment === 'default');
  const branches = credentials.filter((c) => c.environment !== 'default');

  const result: Record<string, unknown> = {};

  if (defaultCred) {
    const def: Record<string, unknown> = {};
    if (defaultCred.username) def.username = defaultCred.username;
    if (defaultCred.password) def.password = defaultCred.password;
    if (defaultCred.extraFields && typeof defaultCred.extraFields === 'object') {
      Object.assign(def, defaultCred.extraFields);
    }
    result.default = def;
  }

  if (branches.length > 0) {
    const branchMap: Record<string, unknown> = {};
    for (const b of branches) {
      const entry: Record<string, unknown> = {};
      if (b.username) entry.username = b.username;
      if (b.password) entry.password = b.password;
      if (b.extraFields && typeof b.extraFields === 'object') {
        Object.assign(entry, b.extraFields);
      }
      branchMap[b.environment] = entry;
    }
    result.branches = branchMap;
  }

  return toYAML(result, { lineWidth: 0 });
}
