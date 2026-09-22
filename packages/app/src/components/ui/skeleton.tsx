import { cn } from "../../lib/utils"

/**
 * `as` is ours, not shadcn's: an `h1` permits phrasing content only, so a
 * screen whose title is still loading needs `as="span"` (with `inline-block`)
 * rather than the default `div`.
 */
function Skeleton({
  as: Tag = "div",
  className,
  ...props
}: React.ComponentProps<"div"> & { as?: "div" | "span" }) {
  return (
    <Tag
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-accent", className)}
      {...props}
    />
  )
}

export { Skeleton }
