"use client";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ExtractorForm } from "@/components/extractor-form";
import { SchemaEditor } from "@/components/schema-editor";
import { CodeViewer } from "@/components/code-viewer";
import { updateExtractor } from "@/app/extractors/actions";

interface ExtractorTabsProps {
  extractor: {
    id: string;
    orgId: string;
    domainId: string;
    country: string;
    variant: string;
    robotTemplate: string;
    parameters: unknown;
    isActive: boolean;
  };
  orgs: { id: string; name: string }[];
  domains: { id: string; name: string }[];
  domainDefaults: Record<string, unknown>;
  schemas: Record<string, unknown>;
  jsOverrides: Record<string, string>;
  schemaYAML?: string;
  overrideId?: string;
  hasGoto2: boolean;
  hasBeforeExtract: boolean;
  hasExtract: boolean;
  hasTransform: boolean;
}

export function ExtractorTabs({
  extractor,
  orgs,
  domains,
  domainDefaults,
  schemas,
  jsOverrides,
  schemaYAML,
  overrideId,
  hasGoto2,
  hasBeforeExtract,
  hasExtract,
  hasTransform,
}: ExtractorTabsProps) {
  const jsTabEntries: Array<{ key: string; label: string; code: string }> = [];
  if (hasGoto2 && jsOverrides.goto2) jsTabEntries.push({ key: 'goto2', label: 'goto2', code: jsOverrides.goto2 });
  if (hasBeforeExtract && jsOverrides.beforeExtract) jsTabEntries.push({ key: 'beforeExtract', label: 'beforeExtract', code: jsOverrides.beforeExtract });
  if (hasExtract && jsOverrides.extract) jsTabEntries.push({ key: 'extract', label: 'extract', code: jsOverrides.extract });
  if (hasTransform && jsOverrides.transform) jsTabEntries.push({ key: 'transform', label: 'transform', code: jsOverrides.transform });

  const schemaTabName = schemaYAML ?? Object.keys(schemas)[0];
  const schemaData = schemaTabName ? schemas[schemaTabName] : null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <Tabs defaultValue="index">
        <TabsList className="w-full justify-start rounded-none border-b bg-gray-50 px-4" variant="line">
          <TabsTrigger value="index">index</TabsTrigger>
          {schemaTabName && <TabsTrigger value="schema">{schemaTabName}</TabsTrigger>}
          {jsTabEntries.map((entry) => (
            <TabsTrigger key={entry.key} value={entry.key}>{entry.label}</TabsTrigger>
          ))}
        </TabsList>

        <div className="p-6">
          <TabsContent value="index">
            <ExtractorForm
              orgs={orgs}
              domains={domains}
              domainDefaults={domainDefaults}
              extractor={extractor}
              action={updateExtractor}
            />
          </TabsContent>

          {schemaTabName != null && schemaData != null && (
            <TabsContent value="schema">
              <SchemaEditor
                schemaName={schemaTabName}
                schema={schemaData as Record<string, unknown>}
                overrideId={overrideId!}
              />
            </TabsContent>
          )}

          {jsTabEntries.map((entry) => (
            <TabsContent key={entry.key} value={entry.key}>
              <CodeViewer filename={`${entry.label}.js`} code={entry.code} />
            </TabsContent>
          ))}
        </div>
      </Tabs>
    </div>
  );
}
