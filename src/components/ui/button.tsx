import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

// The solid variants are RAISED — see `.cb-raised` in globals.css. A button in
// this product is a physical object with a lit top edge and a plinth under it,
// and pressing it moves it 2px down onto that plinth.
//
// It is a cosmetic change with one behavioural consequence worth knowing: the
// travel is real, so a button in a tight flex row moves relative to its
// neighbours on press. That is the point, and it is why the plinth is exactly
// 2px everywhere rather than scaled per size — a `size="lg"` button that sank
// four pixels while the `sm` beside it sank two would read as two different
// controls.
//
// T12.10 — buttons are in the BODY face. T12.8 put the display face on them,
// and with it on titles, numbers and buttons alike nothing stood out; a button
// has to be read, not admired. The raised plinth is what makes it a game
// button, and that stays.
//
// `--raise-shade` is what each variant contributes; `.cb-raised` reads it. A
// variant that sets none gets `transparent` and quietly degrades to a flat
// button, which is the correct fallback and is why `ghost` and `link` — which
// have no body to raise — simply do not opt in.
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // brightness rather than /90 on hover: an opacity step on a button
        // sitting over the textured backdrop lets the shield motif show
        // through the face of the button, which looks like a rendering bug.
        default:
          "cb-raised [--raise-shade:var(--primary-shade)] bg-primary text-primary-foreground hover:brightness-110",
        destructive:
          "cb-raised [--raise-shade:var(--destructive-shade)] bg-destructive text-white hover:brightness-110 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40",
        outline:
          // `border-2`-weight without the width: a full-strength border rather
          // than the 60%-opacity default, so the four clan chips on every
          // roster row read as pressable rather than as table decoration.
          "cb-raised [--raise-shade:var(--surface-shade)] border border-border bg-card hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "cb-raised [--raise-shade:var(--secondary-shade)] bg-secondary text-secondary-foreground hover:bg-secondary/80",
        // No plinth: there is no body to raise. A ghost button is a hover
        // target, and giving it depth at rest would make every toolbar look
        // like a row of solid buttons someone forgot to fill in.
        // A RESTING APPEARANCE, which this variant did not have.
        //
        // It was `hover:bg-accent` and nothing else, so at rest a ghost button
        // was literally indistinguishable from a line of text — no border, no
        // fill, no affordance of any kind. "Drop" on the roster panels is this
        // variant, and members could not tell it was a control until the
        // pointer happened to cross it. On a touch screen there IS no hover, so
        // it never announced itself at all.
        //
        // A hairline border and the faintest wash is enough: it still reads as
        // the quiet option next to `outline` and `default`, which is the job,
        // while being visibly a button. Still no plinth — see the header; there
        // is no body here to raise.
        ghost:
          "border border-border/60 bg-foreground/[0.03] hover:bg-accent hover:text-accent-foreground hover:border-border dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      // Heights up one step across the board, for fingers.
      //
      // `xs` was h-6 — 24px, and with the root type scale now at 112.5% it is
      // 27px. The WCAG target-size guidance is 44px, and `xs` is the size used
      // for every clan-assign chip and every Drop on the roster builder: the
      // densest, most-tapped controls in the product were also the smallest.
      // These land near 31/40/45/49px once the root scale is applied, so
      // `default` and `lg` clear the guideline and the two compact sizes stop
      // being unusable on a phone.
      size: {
        default: "h-10 px-4 py-2 has-[>svg]:px-3",
        xs: "h-7 gap-1 rounded-md px-2.5 text-xs has-[>svg]:px-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-9 gap-1.5 rounded-md px-3.5 has-[>svg]:px-3",
        lg: "h-11 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-10",
        "icon-xs": "size-7 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-9",
        "icon-lg": "size-11",
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
