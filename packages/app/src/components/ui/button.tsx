import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../../lib/utils"
import { Slot } from "radix-ui"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-base font-medium whitespace-nowrap transition-all disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        // Brought onto this system's rules at its first use (the Delete field
        // confirm). No token change was needed — `--color-destructive` is
        // `--fail` and `--color-destructive-foreground` is `--bg` (styles/app.css)
        // — so the pair is `#0a0a0a` on `#ff5c5c` in dark (6.5:1) and `#ffffff`
        // on `#c62828` in light (5.6:1), both over 4.5:1, and both still over it
        // at the 90 % hover blend (5.5:1 / 4.9:1). Written per theme through the
        // tokens rather than as a literal, so it follows `data-theme`. The
        // generator's `shadow-xs` is dropped, as on every other variant.
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        // Brought onto this system's rules at its first use (task 5 left the
        // unused variants as generated): no `shadow-xs` — the spec has no
        // shadow in dark — and no translucent border-colour wash. A hairline
        // that brightens, and a raised fill on hover.
        outline:
          "border border-line bg-transparent hover:border-line-hover hover:bg-raised",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
