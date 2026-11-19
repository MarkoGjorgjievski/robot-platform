import type { ReactNode } from 'react';
import { Popover, PopoverContent } from '@ui-sdk/react/popover';

/**
 * The screenshot as a popover beside the cell it is about (Marko 2026-11-19), on UI SDK's popover: it opens to
 * the right of the cell, flips to the left when there is no room, grows out of the cell and glides to the next
 * one. It has no trigger of its own — the route opens it when a cell or a product asks — and it never takes
 * focus, so the arrow keys keep walking the table underneath.
 *
 * A press outside closes it, except a press inside the table (`keepOpenWithin`): that is a click on another cell
 * or product, which moves the popover rather than closing and reopening it. Focus leaving is not a reason to
 * close — focus was never inside.
 */
export function ScreenshotPopover({
  open,
  anchor,
  onClose,
  keepOpenWithin = '.table-scroll',
  children,
}: {
  open: boolean;
  /** A CSS selector for the cell (or the product's first cell) the screenshot belongs to. */
  anchor: string;
  onClose: () => void;
  keepOpenWithin?: string;
  children: ReactNode;
}) {
  return (
    <Popover
      open={open}
      modal={false}
      onOpenChange={(next, details) => {
        if (next) return;
        if (details.reason === 'focus-out' || details.reason === 'window-blur') return;
        if (details.reason === 'outside-press') {
          const target = details.event?.target as Element | null | undefined;
          if (target?.closest?.(keepOpenWithin)) return;
        }
        onClose();
      }}
    >
      <PopoverContent
        anchor={anchor}
        side="right"
        align="start"
        sideOffset={10}
        collisionPadding={12}
        initialFocus="none"
        finalFocus="none"
        aria-label="Screenshot"
        data-testid="screenshot-popover"
        className="shot-popover m-0 max-h-[min(86vh,var(--available-height,86vh))] w-[min(620px,calc(100vw-24px))] overflow-auto rounded-[8px] border border-line-hover bg-bg p-2 text-text shadow-[0_16px_48px_rgb(0_0_0/0.4)]"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
