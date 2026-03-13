import { redirect } from 'next/navigation';

export default async function EditExtractorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/extractors/${id}`);
}
