import type { ReactNode } from 'react';
import { Info } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@ui-sdk/react/popover';

/**
 * A table's heading with what it is behind an (i) beside it (Marko 2026-11-20): the explanation is for the first
 * visit, and the tables are what people come back for. A popover, not a tooltip, so it is in the page's own colours
 * and can hold short paragraphs, a list and bold words. Opens on hover, and on a press or a key for touch and
 * keyboard.
 */
export function SectionTitle({ title, info }: { title: ReactNode; info: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <Popover openOnHover delay={150} closeDelay={150}>
        <PopoverTrigger aria-label="What is this?" className="rounded-full text-muted-foreground hover:text-text focus-visible:text-text data-[open]:text-text">
          <Info aria-hidden className="size-4" />
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="shot-popover m-0 w-[min(400px,calc(100vw-24px))] space-y-2 rounded-[8px] border border-line bg-panel p-3.5 text-base leading-relaxed text-text [box-shadow:var(--shadow)] [&_strong]:font-semibold [&_ul]:space-y-1"
        >
          {info}
        </PopoverContent>
      </Popover>
    </div>
  );
}
