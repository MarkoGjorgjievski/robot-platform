import { api } from "@/trpc/server";
import { DomainForm } from "@/components/domain-form";
import { updateDomain } from "../../actions";

export default async function EditDomainPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const domain = await api.domains.getById({ id });

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Edit Domain</h1>
        <p className="mt-1 text-sm text-gray-500">
          Update configuration for {domain.name}
        </p>
      </div>

      <DomainForm domain={domain} action={updateDomain} />
    </div>
  );
}
