import { notFound } from "next/navigation";
import Link from "next/link";
import { api } from "@/trpc/server";
import { ExtractorForm } from "@/components/extractor-form";
import { updateExtractor } from "../../actions";
import { db } from "@robot/db";
import { robotOverrides } from "@robot/db";
import { eq, and } from "drizzle-orm";

export default async function EditExtractorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [extractor, orgs, domains] = await Promise.all([
    api.extractors.getById({ id }),
    api.orgs.list(),
    api.domains.list(),
  ]);

  if (!extractor) {
    notFound();
  }

  // Load domain defaults from robot_overrides
  const override = await db.query.robotOverrides.findFirst({
    where: and(
      eq(robotOverrides.domainId, extractor.domainId),
      eq(robotOverrides.country, extractor.country),
    ),
  });

  const domainDefaults =
    (override?.parameterOverrides as Record<string, unknown>) ?? {};

  return (
    <div>
      <div className="mb-6 flex items-center gap-4">
        <Link
          href={`/extractors/${id}`}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
        >
          &larr; Back
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Edit Extractor</h1>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <ExtractorForm
          orgs={orgs}
          domains={domains}
          domainDefaults={domainDefaults}
          extractor={extractor}
          action={updateExtractor}
        />
      </div>
    </div>
  );
}
