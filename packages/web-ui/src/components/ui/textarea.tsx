import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";

import { cn } from "../ai-elements/utils";

export const Textarea = forwardRef<
  ElementRef<"textarea">,
  ComponentPropsWithoutRef<"textarea">
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-warm-surface disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
});
