import { OrgForm } from "@/components/org-form";
import { createOrg } from "../actions";

export default function NewOrgPage() {
  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-6 text-2xl font-bold">Create Organization</h1>
      <OrgForm action={createOrg} />
    </div>
  );
}
