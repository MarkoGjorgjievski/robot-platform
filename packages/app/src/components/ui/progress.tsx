import * as React from "react"
import { cn } from "../../lib/utils"
import { Progress as ProgressPrimitive } from "radix-ui"

/**
 * Brought onto this system's rules at its first use (the verifying strip): the
 * generator's `bg-primary/20` track is a translucent wash of the text colour,
 * which on `--panel` reads as a smudge; the hairline token is the one grey this
 * system already uses for a rule, and the bar itself is `--text`. A 4 px bar,
 * not 8: it is one fact in a strip of them, not the strip's subject.
 *
 * The indicator's `transition-all` is swept to near-zero by app.css's
 * reduced-motion block, so a bar that is repainted every three seconds does not
 * slide for someone who asked for no motion.
 */
function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        "relative h-1 w-full overflow-hidden rounded-full bg-line",
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="h-full w-full flex-1 bg-text transition-all"
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
