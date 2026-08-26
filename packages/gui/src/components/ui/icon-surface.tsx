import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../../lib/cn";
import { semanticToneSurfaceClasses, type SemanticTone } from "./tone";

const iconSurfaceVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-lg border",
  {
    variants: {
      size: {
        sm: "size-7 [&>svg]:size-3.5",
        md: "size-10 [&>svg]:size-5",
        lg: "size-12 [&>svg]:size-6",
      },
    },
    defaultVariants: {
      size: "md",
    },
  },
);

export function IconSurface({
  className,
  size = "md",
  tone,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof iconSurfaceVariants> & { tone: SemanticTone }) {
  return (
    <span
      data-slot="icon-surface"
      data-size={size ?? undefined}
      data-tone={tone}
      className={cn(
        iconSurfaceVariants({ size }),
        semanticToneSurfaceClasses[tone],
        className,
      )}
      {...props}
    />
  );
}

export { iconSurfaceVariants };
