import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Loader2, Search } from 'lucide-react';
import { trpc } from '../lib/trpc';

export default function LandingPage() {
  const navigate = useNavigate();
  const [url, setUrl] = useState('');
  const [fieldsInput, setFieldsInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createMutation = trpc.sandbox.create.useMutation({
    onSuccess: ({ slug }) => {
      navigate({ to: '/sandbox/$shortid', params: { shortid: slug } });
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  function handleSubmit() {
    setError(null);
    if (!url.trim()) {
      setError('URL is required');
      return;
    }
    try {
      new URL(url.trim());
    } catch {
      setError('Not a valid URL');
      return;
    }
    createMutation.mutate({
      url: url.trim(),
      requestedFields: fieldsInput.trim() || undefined,
    });
  }

  const isPending = createMutation.isPending;

  return (
    <div className="mx-auto max-w-xl pt-16">
      <div className="text-center">
        <p className="micro-label text-accent-600">url → schema → data</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">
          Extract structured data from any page
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-gray-500">
          Paste a URL. We capture the page, discover its data fields, and extract
          them — then remember how, so the next run is free.
        </p>
      </div>

      <div className="card mt-10 p-5">
        <div className="flex gap-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !fieldsInput.trim()) handleSubmit();
            }}
            placeholder="https://example.com/products"
            disabled={isPending}
            className="h-11 flex-1 rounded-md border border-gray-300 bg-white px-3 font-mono text-sm placeholder:text-gray-400 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-100 disabled:opacity-50"
          />
          <button onClick={handleSubmit} disabled={isPending || !url.trim()} className="btn-primary h-11">
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Analyze
          </button>
        </div>

        <div className="mt-4">
          <label className="text-xs font-medium text-gray-600">
            Fields you need{' '}
            <span className="font-normal text-gray-400">(optional — one per line or comma-separated)</span>
          </label>
          <textarea
            value={fieldsInput}
            onChange={(e) => setFieldsInput(e.target.value)}
            placeholder={'price\ntitle\nrating\navailability'}
            rows={4}
            disabled={isPending}
            className="mt-1.5 w-full resize-none rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-sm placeholder:text-gray-400 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-100 disabled:opacity-50"
          />
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}
    </div>
  );
}
