"use client";

type Props = {
  orgs: { id: string; name: string }[];
  domains: { id: string; name: string }[];
  extractor?: {
    id: string;
    orgId: string;
    domainId: string;
    country: string;
    variant: string;
    robotTemplate: string;
    parameters: unknown;
    isActive: boolean;
  };
  action: (formData: FormData) => Promise<void>;
};

const labelClass = "block text-sm font-medium text-gray-700";
const inputClass =
  "mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

export function ExtractorForm({ orgs, domains, extractor, action }: Props) {
  const isEdit = !!extractor;

  return (
    <form action={action} className="space-y-5">
      {isEdit && <input type="hidden" name="id" value={extractor.id} />}

      {/* Org */}
      <div>
        <label htmlFor="orgId" className={labelClass}>
          Organization <span className="text-red-500">*</span>
        </label>
        <select
          id="orgId"
          name="orgId"
          required
          defaultValue={extractor?.orgId ?? ""}
          className={inputClass}
        >
          <option value="" disabled>
            Select an organization
          </option>
          {orgs.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
        </select>
      </div>

      {/* Domain */}
      <div>
        <label htmlFor="domainId" className={labelClass}>
          Domain <span className="text-red-500">*</span>
        </label>
        <select
          id="domainId"
          name="domainId"
          required
          defaultValue={extractor?.domainId ?? ""}
          className={inputClass}
        >
          <option value="" disabled>
            Select a domain
          </option>
          {domains.map((domain) => (
            <option key={domain.id} value={domain.id}>
              {domain.name}
            </option>
          ))}
        </select>
      </div>

      {/* Country */}
      <div>
        <label htmlFor="country" className={labelClass}>
          Country <span className="text-red-500">*</span>
        </label>
        <input
          id="country"
          name="country"
          type="text"
          required
          defaultValue={extractor?.country ?? ""}
          placeholder="e.g. US"
          className={inputClass}
        />
      </div>

      {/* Variant */}
      <div>
        <label htmlFor="variant" className={labelClass}>
          Variant <span className="text-red-500">*</span>
        </label>
        <input
          id="variant"
          name="variant"
          type="text"
          required
          defaultValue={extractor?.variant ?? ""}
          placeholder="e.g. default"
          className={inputClass}
        />
      </div>

      {/* Robot Template */}
      <div>
        <label htmlFor="robotTemplate" className={labelClass}>
          Robot Template
        </label>
        <input
          id="robotTemplate"
          name="robotTemplate"
          type="text"
          defaultValue={extractor?.robotTemplate ?? "robots/san-antonio"}
          className={inputClass}
        />
      </div>

      {/* Active */}
      <div className="flex items-center gap-3">
        <input
          id="isActive"
          name="isActive"
          type="checkbox"
          defaultChecked={extractor?.isActive ?? true}
          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        <label htmlFor="isActive" className="text-sm font-medium text-gray-700">
          Active
        </label>
      </div>

      {/* Parameters */}
      <div>
        <label htmlFor="parameters" className={labelClass}>
          Parameters (JSON)
        </label>
        <textarea
          id="parameters"
          name="parameters"
          rows={8}
          defaultValue={
            extractor?.parameters
              ? JSON.stringify(extractor.parameters, null, 2)
              : "{}"
          }
          className={`${inputClass} font-mono`}
        />
      </div>

      {/* Submit */}
      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          {isEdit ? "Update Extractor" : "Create Extractor"}
        </button>
      </div>
    </form>
  );
}
