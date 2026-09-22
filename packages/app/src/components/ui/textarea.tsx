import * as React from "react"
import { cn } from "../../lib/utils"

// The same three deviations `input.tsx` makes, for the same reasons: no
// `shadow-xs` (spec §4 has no shadow on a control in dark), focus is the border
// going to the text colour rather than a 3px translucent ring, and the text is
// a literal 16px on a phone — anything smaller makes iOS Safari zoom on focus —
// stepping down to the 13px body from `md`. `field-sizing-content` is dropped
// too: the pasted list of URLs this box is for would grow the page by a line
// per paste, so it keeps the height its `rows` asks for and scrolls.
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-[16px] transition-[color,box-shadow] outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 md:text-base dark:bg-input/30",
        "focus-visible:border-text",
        "aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
