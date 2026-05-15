import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Sparkles, Loader2, Search } from 'lucide-react';
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
    <div className="mx-auto max-w-xl pt-12">
      <div className="flex flex-col items-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100">
          <Sparkles className="h-7 w-7 text-gray-600" />
        </div>
        <h1 className="mt-4 text-lg font-semibold">Extract data from a URL</h1>
        <p className="mt-1 text-sm text-gray-600">
          Paste a URL and we'll capture the page, discover the data fields, and extract structured data.
        </p>
      </div>

      <div className="mt-8 flex gap-2">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !fieldsInput.trim()) handleSubmit();
          }}
          placeholder="https://example.com/products"
          disabled={isPending}
          className="h-11 flex-1 rounded-md border border-gray-300 px-3 text-sm disabled:opacity-50"
        />
        <button
          onClick={handleSubmit}
          disabled={isPending || !url.trim()}
          className="flex h-11 items-center gap-2 rounded-md bg-gray-900 px-4 text-sm font-medium text-white disabled:opacity-50"
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          Analyze
        </button>
      </div>

      <div className="mt-4">
        <label className="text-xs text-gray-600">
          Fields you need <span className="text-gray-400">(optional — one per line or comma-separated)</span>
        </label>
        <textarea
          value={fieldsInput}
          onChange={(e) => setFieldsInput(e.target.value)}
          placeholder={'price\ntitle\nrating\navailability'}
          rows={4}
          disabled={isPending}
          className="mt-1.5 w-full resize-none rounded-md border border-gray-300 px-3 py-2 font-mono text-sm disabled:opacity-50"
        />
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
    </div>
  );
}
