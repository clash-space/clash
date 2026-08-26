import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../../lib/cn";

const artworkSlotVariants = cva(
  "inline-flex shrink-0 items-center justify-center",
  {
    variants: {
      size: {
        sm: "size-[var(--artwork-slot-sm)]",
        md: "size-[var(--artwork-slot-md)]",
        lg: "size-[var(--artwork-slot-lg)]",
        xl: "size-[var(--artwork-slot-xl)]",
      },
    },
    defaultVariants: {
      size: "md",
    },
  },
);

function ArtworkSlot({
  className,
  size = "md",
  slot = "artwork-slot",
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof artworkSlotVariants> & {
    slot?: string;
  }) {
  return (
    <span
      data-ui="artwork-slot"
      data-slot={slot}
      data-size={size}
      className={cn(artworkSlotVariants({ size }), className)}
      {...props}
    />
  );
}

export { ArtworkSlot, artworkSlotVariants };
