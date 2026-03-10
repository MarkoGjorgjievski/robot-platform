import Link from 'next/link';
import { notFound } from 'next/navigation';
import { api } from '@/trpc/server';
import { ExtractorTabs } from '@/components/extractor-tabs';

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
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center gap-4">
        <Link
          href="/extractors"
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
        >
          &larr; Back
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">
            {extractor.org.name} &mdash; {extractor.domain.name}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {extractor.country} &middot; {extractor.variant}
          </p>
        </div>
        <span
          className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${
            extractor.isActive
              ? 'bg-green-100 text-green-800'
              : 'bg-red-100 text-red-800'
          }`}
        >
          {extractor.isActive ? 'Active' : 'Inactive'}
        </span>
        <a
          href={`/api/extractors/${extractor.id}/yaml`}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
        >
          Export YAML
        </a>
      </div>

      {/* Tabs */}
      <ExtractorTabs
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
      />

      {/* Inputs */}
      <section className="mt-8 mb-6 rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Inputs</h2>
        </div>
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Label</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Input Data</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {extractor.inputs.map((input) => (
              <tr key={input.id}>
                <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">{input.label}</td>
                <td className="max-w-md px-6 py-4 text-sm text-gray-700">
                  <pre className="truncate rounded bg-gray-50 px-2 py-1 text-xs">{JSON.stringify(input.inputData)}</pre>
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">{new Date(input.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
            {extractor.inputs.length === 0 && (
              <tr><td colSpan={3} className="px-6 py-8 text-center text-sm text-gray-500">No inputs found.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {/* Credentials */}
      <section className="mb-6 rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Credentials</h2>
        </div>
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Environment</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Username</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {extractor.credentials.map((credential) => (
              <tr key={credential.id}>
                <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">{credential.environment}</td>
                <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-700">{credential.username}</td>
                <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">{new Date(credential.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
            {extractor.credentials.length === 0 && (
              <tr><td colSpan={3} className="px-6 py-8 text-center text-sm text-gray-500">No credentials found.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {/* Recent Runs */}
      <section className="mb-6 rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Recent Runs</h2>
        </div>
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Input</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Started</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Completed</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {recentRuns.map((run) => (
              <tr key={run.id}>
                <td className="whitespace-nowrap px-6 py-4 text-sm">
                  <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
                    run.status === 'completed' ? 'bg-green-100 text-green-800'
                    : run.status === 'failed' ? 'bg-red-100 text-red-800'
                    : run.status === 'running' ? 'bg-blue-100 text-blue-800'
                    : 'bg-gray-100 text-gray-800'
                  }`}>{run.status}</span>
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-700">{run.inputLabel ?? '\u2014'}</td>
                <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">{run.startedAt ? new Date(run.startedAt).toLocaleString() : '\u2014'}</td>
                <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">{run.completedAt ? new Date(run.completedAt).toLocaleString() : '\u2014'}</td>
                <td className="whitespace-nowrap px-6 py-4 text-sm">
                  <Link href={`/runs/${run.id}`} className="text-blue-600 hover:text-blue-800">View</Link>
                </td>
              </tr>
            ))}
            {recentRuns.length === 0 && (
              <tr><td colSpan={5} className="px-6 py-8 text-center text-sm text-gray-500">No runs yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
