import Link from 'next/link';
import { api } from '@/trpc/server';

export default async function ExtractorsPage() {
  const extractors = await api.extractors.list();

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Extractors</h1>
        <Link
          href="/extractors/new"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
        >
          New Extractor
        </Link>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Org
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Domain
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Country
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Variant
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Template
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Active
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Created
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {extractors.map((extractor) => (
              <tr key={extractor.id} className="hover:bg-gray-50">
                <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">
                  <Link
                    href={`/extractors/${extractor.id}`}
                    className="text-blue-600 hover:text-blue-800 hover:underline"
                  >
                    {extractor.org.name}
                  </Link>
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-700">
                  {extractor.domain.name}
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-700">
                  {extractor.country}
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-700">
                  {extractor.variant}
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-700">
                  {extractor.robotTemplate}
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-sm">
                  <span
                    className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold leading-5 ${
                      extractor.isActive
                        ? 'bg-green-100 text-green-800'
                        : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {extractor.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                  {new Date(extractor.createdAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {extractors.length === 0 && (
          <div className="py-12 text-center text-sm text-gray-500">
            No extractors found.
          </div>
        )}
      </div>
    </div>
  );
}
