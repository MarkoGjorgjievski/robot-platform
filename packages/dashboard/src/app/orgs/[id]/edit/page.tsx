import { api } from "@/trpc/server";
import { OrgForm } from "@/components/org-form";
import { updateOrg } from "../../actions";
import { notFound } from "next/navigation";

export default async function EditOrgPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const org = await api.orgs.getById({ id });

  if (!org) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-6 text-2xl font-bold">Edit Organization</h1>
      <OrgForm org={org} action={updateOrg} />
    </div>
  );
}
