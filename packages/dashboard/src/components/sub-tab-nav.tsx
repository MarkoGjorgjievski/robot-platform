import { Link } from '@tanstack/react-router';

type Tab = {
  label: string;
  to: string;
  params: Record<string, string>;
};

export function SubTabNav({ tabs, activeTo }: { tabs: Tab[]; activeTo: string }) {
  return (
    <div className="mt-4 border-b">
      <nav className="flex gap-4">
        {tabs.map((tab) => {
          const isActive = tab.to === activeTo;
          return (
            <Link
              key={tab.to}
              to={tab.to as never}
              params={tab.params as never}
              className={`-mb-px border-b-2 px-1 py-2 text-sm transition-colors ${
                isActive
                  ? 'border-gray-900 font-medium text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
