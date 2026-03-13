export default function SourceDetailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 ml-12">
      {children}
    </div>
  );
}
