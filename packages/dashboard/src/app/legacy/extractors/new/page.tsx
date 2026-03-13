import { api } from "@/trpc/server";
import { ExtractorForm } from "@/components/extractor-form";
import { createExtractor } from "../actions";
import Link from "next/link";

export default async function NewExtractorPage() {
  const [orgs, domains] = await Promise.all([
    api.orgs.list(),
    api.domains.list(),
  ]);

  return (
    <div>
      <div className="mb-6 flex items-center gap-4">
        <Link
          href="/extractors"
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
        >
          &larr; Back
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">New Extractor</h1>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <ExtractorForm orgs={orgs} domains={domains} action={createExtractor} />
      </div>
    </div>
  );
}
