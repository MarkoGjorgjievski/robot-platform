"use client";

import Link from "next/link";

type Props = {
  domain?: {
    id: string;
    name: string;
    prefix: string | null;
    hasGotoOverride: boolean;
    hasSetZipCodeOverride: boolean;
  };
  action: (formData: FormData) => Promise<void>;
};

export function DomainForm({ domain, action }: Props) {
  return (
    <form action={action} className="max-w-lg space-y-6">
      {domain && <input type="hidden" name="id" value={domain.id} />}

      <div>
        <label htmlFor="name" className="block text-sm font-medium text-gray-700">
          Name <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          id="name"
          name="name"
          required
          defaultValue={domain?.name ?? ""}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <div>
        <label htmlFor="prefix" className="block text-sm font-medium text-gray-700">
          Prefix
        </label>
        <input
          type="text"
          id="prefix"
          name="prefix"
          defaultValue={domain?.prefix ?? ""}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id="hasGotoOverride"
            name="hasGotoOverride"
            defaultChecked={domain?.hasGotoOverride ?? false}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <label htmlFor="hasGotoOverride" className="text-sm font-medium text-gray-700">
            Has Goto Override
          </label>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id="hasSetZipCodeOverride"
            name="hasSetZipCodeOverride"
            defaultChecked={domain?.hasSetZipCodeOverride ?? false}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <label htmlFor="hasSetZipCodeOverride" className="text-sm font-medium text-gray-700">
            Has Set Zip Code Override
          </label>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <button
          type="submit"
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          Save
        </button>
        <Link
          href="/domains"
          className="text-sm font-medium text-gray-600 hover:text-gray-900"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
