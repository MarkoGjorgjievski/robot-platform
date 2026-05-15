type PlaceholderProps = {
  title: string;
  phase: string;
  params?: Record<string, string>;
};

export function Placeholder({ title, phase, params }: PlaceholderProps) {
  return (
    <div>
      <h1 className="text-xl font-bold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-gray-600">Stub route — full implementation in {phase}.</p>
      {params && Object.keys(params).length > 0 && (
        <pre className="mt-4 rounded bg-gray-100 p-3 text-xs">{JSON.stringify(params, null, 2)}</pre>
      )}
    </div>
  );
}
