import { Link } from '@tanstack/react-router';

type Tab = {
  label: string;
  to: string;
  params: Record<string, string>;
};

export function SubTabNav({ tabs, activeTo }: { tabs: Tab[]; activeTo: string }) {
  return (
    <div className="mt-4 border-b border-gray-200">
      <nav className="flex gap-5">
        {tabs.map((tab) => {
          const isActive = tab.to === activeTo;
          return (
            <Link
              key={tab.to}
              to={tab.to as never}
              params={tab.params as never}
              className={`-mb-px border-b-2 px-0.5 py-2 text-sm transition-colors ${
                isActive
                  ? 'border-accent-600 font-medium text-gray-900'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-800'
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
