import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYAML } from 'yaml';

export type ParsedExtractor = {
  orgName: string;
  domainName: string;
  country: string;
  robotTemplate: string;
  variant: string;
  parameters: Record<string, unknown>;
  timeout?: number;
  inputs: Array<{ label: string; inputData: Record<string, unknown> }>;
  credentials: Array<{
    environment: string;
    username?: string;
    password?: string;
    extraFields?: Record<string, unknown>;
  }>;
};

async function readYAMLFile(filePath: string): Promise<unknown> {
  try {
    const content = await readFile(filePath, 'utf-8');
    return parseYAML(content);
  } catch {
    return null;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function safeReaddir(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path);
    return entries.filter((e) => !e.startsWith('.'));
  } catch {
    return [];
  }
}

/**
 * Walk the extractor leaf directory (contains extractor.yaml, inputs.yaml, credentials.yaml)
 */
async function parseExtractorDir(
  dirPath: string,
  orgName: string,
  domainName: string,
  country: string,
  robotTemplate: string,
  variant: string,
): Promise<ParsedExtractor | null> {
  const extractorYaml = (await readYAMLFile(join(dirPath, 'extractor.yaml'))) as Record<string, unknown> | null;
  if (!extractorYaml) return null;

  const parameters = (extractorYaml.parameters as Record<string, unknown>) ?? {};
  const timeout = extractorYaml.timeout as number | undefined;

  // Parse inputs
  const inputs: ParsedExtractor['inputs'] = [];
  const inputsYaml = (await readYAMLFile(join(dirPath, 'inputs.yaml'))) as Record<string, unknown> | null;
  if (inputsYaml && typeof inputsYaml === 'object') {
    for (const [label, data] of Object.entries(inputsYaml)) {
      inputs.push({
        label,
        inputData: (typeof data === 'object' && data !== null ? data : { value: data }) as Record<string, unknown>,
      });
    }
  }

  // Parse credentials
  const credentials: ParsedExtractor['credentials'] = [];
  const credentialsYaml = (await readYAMLFile(join(dirPath, 'credentials.yaml'))) as Record<string, unknown> | null;
  if (credentialsYaml && typeof credentialsYaml === 'object') {
    // Default credentials
    if (credentialsYaml.default && typeof credentialsYaml.default === 'object') {
      const def = credentialsYaml.default as Record<string, unknown>;
      const { username, password, ...extra } = def;
      credentials.push({
        environment: 'default',
        username: username as string | undefined,
        password: password as string | undefined,
        extraFields: Object.keys(extra).length > 0 ? extra : undefined,
      });
    }
    // Branch credentials
    if (credentialsYaml.branches && typeof credentialsYaml.branches === 'object') {
      for (const [env, data] of Object.entries(credentialsYaml.branches as Record<string, unknown>)) {
        if (typeof data === 'object' && data !== null) {
          const { username, password, ...extra } = data as Record<string, unknown>;
          credentials.push({
            environment: env,
            username: username as string | undefined,
            password: password as string | undefined,
            extraFields: Object.keys(extra).length > 0 ? extra : undefined,
          });
        }
      }
    }
  }

  return {
    orgName,
    domainName,
    country,
    robotTemplate: (extractorYaml.robot as string) ?? `robots/${robotTemplate}`,
    variant,
    parameters,
    timeout,
    inputs,
    credentials,
  };
}

/**
 * Parse the entire src/orgs/ directory structure into ParsedExtractor objects.
 * Structure: orgs/{org}/domains/{letter}/{domain}/{country}/{robot}/{variant}/
 * Exception: sathiya uses orgs/{org}/robots/domains/{letter}/...
 */
export async function parseOrgsDirectory(orgsPath: string): Promise<ParsedExtractor[]> {
  const results: ParsedExtractor[] = [];
  const orgDirs = await safeReaddir(orgsPath);

  for (const orgName of orgDirs) {
    const orgPath = join(orgsPath, orgName);
    if (!(await isDirectory(orgPath))) continue;

    // Find the domains directory (could be domains/ or robots/domains/)
    let domainsRoot = join(orgPath, 'domains');
    if (!(await isDirectory(domainsRoot))) {
      domainsRoot = join(orgPath, 'robots', 'domains');
      if (!(await isDirectory(domainsRoot))) continue;
    }

    // Iterate letter directories
    const letterDirs = await safeReaddir(domainsRoot);
    for (const letter of letterDirs) {
      const letterPath = join(domainsRoot, letter);
      if (!(await isDirectory(letterPath))) continue;

      // Iterate domain directories
      const domainDirs = await safeReaddir(letterPath);
      for (const domainName of domainDirs) {
        const domainPath = join(letterPath, domainName);
        if (!(await isDirectory(domainPath))) continue;

        // Iterate country directories
        const countryDirs = await safeReaddir(domainPath);
        for (const country of countryDirs) {
          const countryPath = join(domainPath, country);
          if (!(await isDirectory(countryPath))) continue;

          // Iterate robot directories
          const robotDirs = await safeReaddir(countryPath);
          for (const robot of robotDirs) {
            const robotPath = join(countryPath, robot);
            if (!(await isDirectory(robotPath))) continue;

            // Iterate variant directories (singlePage, multiPages, details, search, auth, cpe, lambda)
            const variantDirs = await safeReaddir(robotPath);
            for (const variant of variantDirs) {
              const variantPath = join(robotPath, variant);
              if (!(await isDirectory(variantPath))) continue;

              const parsed = await parseExtractorDir(variantPath, orgName, domainName, country, robot, variant);
              if (parsed) {
                results.push(parsed);
              }
            }
          }
        }
      }
    }
  }

  return results;
}
