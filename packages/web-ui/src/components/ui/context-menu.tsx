import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
} from "react";
import { ContextMenu as ContextMenuPrimitive } from "radix-ui";

import { cn } from "../ai-elements/utils";

export const ContextMenu = ContextMenuPrimitive.Root;
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

export const ContextMenuContent = forwardRef<
  ElementRef<typeof ContextMenuPrimitive.Content>,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(function ContextMenuContent(
  {
    className,
    collisionPadding = 12,
    ...props
  },
  ref,
) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        ref={ref}
        collisionPadding={collisionPadding}
        className={cn(
          "z-[90] min-w-48 overflow-hidden rounded-xl border border-overlay-border bg-overlay-surface p-1 text-content-primary shadow-overlay backdrop-blur-md",
          className,
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  );
});

export const ContextMenuLabel = forwardRef<
  ElementRef<typeof ContextMenuPrimitive.Label>,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Label>
>(function ContextMenuLabel({ className, ...props }, ref) {
  return (
    <ContextMenuPrimitive.Label
      ref={ref}
      className={cn(
        "truncate px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-content-muted",
        className,
      )}
      {...props}
    />
  );
});

export const ContextMenuItem = forwardRef<
  ElementRef<typeof ContextMenuPrimitive.Item>,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item>
>(function ContextMenuItem({ className, disabled, ...props }, ref) {
  return (
    <ContextMenuPrimitive.Item
      ref={ref}
      disabled={disabled}
      className={cn(
        "flex min-h-8 w-full select-none items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] leading-5 text-content-primary outline-none transition-colors",
        "data-[highlighted]:bg-warm-muted/80",
        disabled && "cursor-not-allowed opacity-45",
        className,
      )}
      {...props}
    />
  );
});

export const ContextMenuSeparator = forwardRef<
  ElementRef<typeof ContextMenuPrimitive.Separator>,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>
>(function ContextMenuSeparator({ className, ...props }, ref) {
  return (
    <ContextMenuPrimitive.Separator
      ref={ref}
      className={cn("mx-2 my-1 h-px bg-overlay-border", className)}
      {...props}
    />
  );
});
