'use client';

import { useState } from 'react';
import { Database, Image, Settings, Table2 } from 'lucide-react';

type Tab = 'data' | 'schema' | 'captures' | 'settings';

const tabs: { key: Tab; label: string; icon: typeof Table2 }[] = [
  { key: 'data', label: 'Data', icon: Table2 },
  { key: 'schema', label: 'Schema', icon: Database },
  { key: 'captures', label: 'Captures', icon: Image },
  { key: 'settings', label: 'Settings', icon: Settings },
];

export function SourceDetail({
  orgSlug,
  sourceId,
}: {
  orgSlug: string;
  sourceId: string;
}) {
  const [activeTab, setActiveTab] = useState<Tab>('data');

  return (
    <div className="mt-4">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">
        Source Detail
      </h1>
      <p className="mt-1 font-mono text-xs text-slate-400">{sourceId}</p>

      {/* Tab Bar */}
      <div className="mt-6 flex border-b border-slate-200">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            <tab.icon className="size-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="mt-6">
        {activeTab === 'data' && (
          <div className="rounded-xl border border-dashed border-slate-200 p-12 text-center">
            <Table2 className="mx-auto size-8 text-slate-300" />
            <p className="mt-3 text-sm text-slate-500">
              No extraction data yet. Run an extraction from the Captures tab.
            </p>
          </div>
        )}

        {activeTab === 'schema' && (
          <div className="rounded-xl border border-dashed border-slate-200 p-12 text-center">
            <Database className="mx-auto size-8 text-slate-300" />
            <p className="mt-3 text-sm text-slate-500">
              Schema editor coming soon.
            </p>
          </div>
        )}

        {activeTab === 'captures' && (
          <div className="rounded-xl border border-dashed border-slate-200 p-12 text-center">
            <Image className="mx-auto size-8 text-slate-300" />
            <p className="mt-3 text-sm text-slate-500">
              No captures yet.
            </p>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="rounded-xl border border-dashed border-slate-200 p-12 text-center">
            <Settings className="mx-auto size-8 text-slate-300" />
            <p className="mt-3 text-sm text-slate-500">
              Source settings coming soon.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
