import * as React from "react"
import { cn } from "../../lib/utils"

// Two deviations from the generated component, both forced by our 13px root:
// the small-screen size is pinned to a literal 16px (shadcn's `text-base` is
// 13px here, and anything under 16px makes iOS Safari zoom on focus), and the
// wide-screen size is `text-base` — the spec's 13px body — rather than the 12px
// secondary size, because this is text a person types.
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-[16px] shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-base dark:bg-input/30",
        // Focus is the border going to the text colour — no ring. shadcn's
        // 3px translucent ring reads as a glow, which this system does not have.
        "focus-visible:border-text",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
