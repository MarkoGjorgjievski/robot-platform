import Link from "next/link";
import { api } from "@/trpc/server";

export default async function DomainDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const domain = await api.domains.getById({ id });

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{domain.name}</h1>
          {domain.prefix && (
            <p className="mt-1 text-sm text-gray-500">
              Prefix: <span className="font-mono">{domain.prefix}</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/domains"
            className="text-sm font-medium text-gray-600 hover:text-gray-900"
          >
            Back
          </Link>
          <Link
            href={`/domains/${id}/edit`}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
          >
            Edit
          </Link>
        </div>
      </div>

      <div className="mb-8 flex items-center gap-3">
        <span
          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
            domain.hasGotoOverride
              ? "bg-green-100 text-green-700"
              : "bg-gray-100 text-gray-500"
          }`}
        >
          Goto Override: {domain.hasGotoOverride ? "Yes" : "No"}
        </span>
        <span
          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
            domain.hasSetZipCodeOverride
              ? "bg-green-100 text-green-700"
              : "bg-gray-100 text-gray-500"
          }`}
        >
          Set Zip Code Override: {domain.hasSetZipCodeOverride ? "Yes" : "No"}
        </span>
      </div>

      <div>
        <h2 className="mb-4 text-lg font-semibold text-gray-900">
          Robot Overrides
        </h2>
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Country
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Template
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  hasGoto2
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  hasBeforeExtract
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  hasExtract
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  hasTransform
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {domain.robotOverrides.map((override) => (
                <tr key={override.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900">
                    {override.country}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                    {override.robotTemplate}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        override.hasGoto2
                          ? "bg-green-100 text-green-700"
                          : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {override.hasGoto2 ? "Yes" : "No"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        override.hasBeforeExtract
                          ? "bg-green-100 text-green-700"
                          : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {override.hasBeforeExtract ? "Yes" : "No"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        override.hasExtract
                          ? "bg-green-100 text-green-700"
                          : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {override.hasExtract ? "Yes" : "No"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        override.hasTransform
                          ? "bg-green-100 text-green-700"
                          : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {override.hasTransform ? "Yes" : "No"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {domain.robotOverrides.length === 0 && (
            <div className="px-6 py-12 text-center text-sm text-gray-500">
              No robot overrides configured for this domain.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
