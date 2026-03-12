export default function ExtractorDetailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // This layout overrides the parent's padding/margin so the workspace
  // can render full-bleed. The sidebar is still present from the root layout.
  return (
    <div className="fixed inset-0 ml-64">
      {children}
    </div>
  );
}
