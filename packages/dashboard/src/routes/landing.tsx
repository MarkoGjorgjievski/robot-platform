import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Loader2, ArrowRight, ListOrdered, FileText } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { parseUrlLines } from '../lib/parse-url-lines';

type Mode = 'listing' | 'detail';

const MODES: Array<{ mode: Mode; icon: typeof ListOrdered; title: string; description: string; placeholder: string }> = [
  {
    mode: 'listing',
    icon: ListOrdered,
    title: 'Listing pages',
    description: "Pages that list many products. We'll find every product and crawl them.",
    placeholder: 'https://www.ikea.com/us/en/cat/sofas-fu003/\nhttps://www.ikea.com/us/en/cat/chairs-fu002/',
  },
  {
    mode: 'detail',
    icon: FileText,
    title: 'Product pages',
    description: 'Direct product URLs. We extract each one.',
    placeholder: 'https://www.ikea.com/us/en/p/kivik-sofa-30575629/\nhttps://www.ikea.com/us/en/p/poang-chair-90499858/',
  },
];

export default function LandingPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('listing');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const activeMode = MODES.find((m) => m.mode === mode)!;

  const createMutation = trpc.sources.quickCreate.useMutation({
    onSuccess: ({ projectSlug, sourceSlug }) => {
      navigate({ to: '/p/$project/sources/$source', params: { project: projectSlug, source: sourceSlug } });
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  const isPending = createMutation.isPending;

  function handleSubmit() {
    setError(null);
    const { urls, invalid } = parseUrlLines(text);

    if (invalid.length > 0) {
      setError(`Not a valid URL:\n${invalid.join('\n')}`);
      return;
    }
    if (urls.length === 0) {
      setError('Enter at least one URL');
      return;
    }

    createMutation.mutate({ mode, urls });
  }

  return (
    <div className="mx-auto max-w-xl pt-16">
      <div className="text-center">
        <p className="micro-label text-accent-600">url → schema → data</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">
          Extract structured data from any page
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-gray-500">
          Tell us what kind of page you're starting from. We capture it, discover its data
          fields, and extract them — then remember how, so the next run is free.
        </p>
      </div>

      <div className="mt-10 grid grid-cols-2 gap-3">
        {MODES.map(({ mode: m, icon: Icon, title, description }) => {
          const selected = mode === m;
          return (
            <button
              key={m}
              type="button"
              aria-pressed={selected}
              disabled={isPending}
              onClick={() => setMode(m)}
              className={`card p-4 text-left transition-colors disabled:opacity-50 ${
                selected
                  ? 'border-accent-500 ring-2 ring-accent-100'
                  : 'hover:border-gray-300'
              }`}
            >
              <Icon className={`h-5 w-5 ${selected ? 'text-accent-600' : 'text-gray-400'}`} />
              <p className="mt-2 text-sm font-semibold text-gray-900">{title}</p>
              <p className="mt-1 text-xs text-gray-500">{description}</p>
            </button>
          );
        })}
      </div>

      <div className="card mt-4 p-5">
        <label className="micro-label">Page URLs, one per line</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={activeMode.placeholder}
          rows={6}
          disabled={isPending}
          className="mt-1.5 w-full resize-none rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-sm placeholder:text-gray-400 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-100 disabled:opacity-50"
        />

        <button
          onClick={handleSubmit}
          disabled={isPending || !text.trim()}
          className="btn-primary mt-4 h-11 w-full"
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          {isPending ? 'Setting up…' : 'Start'}
        </button>
      </div>

      {error && (
        <div className="mt-4 whitespace-pre-line rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}
    </div>
  );
}
