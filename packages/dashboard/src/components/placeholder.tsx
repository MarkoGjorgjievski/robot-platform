import { PageHeader } from './page-header';

type PlaceholderProps = {
  title: string;
  phase: string;
  params?: Record<string, string>;
};

export function Placeholder({ title, phase, params }: PlaceholderProps) {
  return (
    <div>
      <PageHeader title={title} description={`Stub route — full implementation in ${phase}.`} />
      {params && Object.keys(params).length > 0 && (
        <pre className="mt-4 rounded bg-gray-100 p-3 text-xs">{JSON.stringify(params, null, 2)}</pre>
      )}
    </div>
  );
}
