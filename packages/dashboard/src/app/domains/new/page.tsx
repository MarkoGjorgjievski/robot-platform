import { DomainForm } from "@/components/domain-form";
import { createDomain } from "../actions";

export default function NewDomainPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">New Domain</h1>
        <p className="mt-1 text-sm text-gray-500">
          Create a new target domain configuration
        </p>
      </div>

      <DomainForm action={createDomain} />
    </div>
  );
}
