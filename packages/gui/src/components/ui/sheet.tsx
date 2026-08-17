import {
  Children,
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
} from "react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { cn } from "../../lib/cn";

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetTitle = DialogPrimitive.Title;
export const SheetDescription = DialogPrimitive.Description;

export interface SheetOverlayProps
  extends ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay> {
  active?: boolean;
  /** Optional local surface that owns this sheet's visual boundary. */
  portalContainer?: HTMLElement | null;
}

export const SheetOverlay = forwardRef<
  ElementRef<typeof DialogPrimitive.Overlay>,
  SheetOverlayProps
>(function SheetOverlay(
  { active = true, className, portalContainer, ...props },
  ref,
) {
  if (!active) return null;

  return (
    <DialogPrimitive.Portal container={portalContainer ?? undefined}>
      <DialogPrimitive.Overlay
        ref={ref}
        className={cn(
          "fixed inset-0 z-40 bg-slate-950/35 backdrop-blur-sm",
          className,
        )}
        {...props}
      />
    </DialogPrimitive.Portal>
  );
});

export interface SheetContentProps
  extends ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  active?: boolean;
  /** Optional local surface that owns this sheet's visual boundary. */
  portalContainer?: HTMLElement | null;
}

export const SheetContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(function SheetContent(
  { active = true, className, children, portalContainer, ...props },
  ref,
) {
  if (!active) {
    return <>{Children.only(children)}</>;
  }

  return (
    <DialogPrimitive.Portal container={portalContainer ?? undefined}>
      <DialogPrimitive.Content
        ref={ref}
        className={cn("outline-none", className)}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});
