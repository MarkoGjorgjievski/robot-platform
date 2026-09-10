import type { ReactNode } from 'react';

/**
 * The standard page opening: title, one-line description, optional actions on
 * the right. Every list/detail route opens with this so the type scale stays
 * uniform across the app.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="name text-2xl leading-[1.2]">{title}</h1>
        {description && <p className="mt-1 text-xs leading-[1.4] text-gray-600">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
