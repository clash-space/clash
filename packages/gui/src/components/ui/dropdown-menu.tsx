import {
  createContext,
  forwardRef,
  useContext,
  type ComponentPropsWithoutRef,
  type ElementRef,
} from "react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";

import { cn } from "../../lib/cn";
import { useExclusivePopupOpen, usePopupFocusPolicy } from "./popup-focus";

type DropdownFocusPolicy = ReturnType<
  typeof usePopupFocusPolicy<HTMLButtonElement>
>;
const DropdownFocusContext = createContext<DropdownFocusPolicy | null>(null);

export function DropdownMenu({
  modal = false,
  open: controlledOpen,
  defaultOpen,
  onOpenChange,
  ...props
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Root>) {
  const focusPolicy = usePopupFocusPolicy<HTMLButtonElement>();
  const popup = useExclusivePopupOpen({
    open: controlledOpen,
    defaultOpen,
    onOpenChange,
  });
  return (
    <DropdownFocusContext.Provider value={focusPolicy}>
      <DropdownMenuPrimitive.Root
        modal={modal}
        open={popup.open}
        onOpenChange={popup.setOpen}
        {...props}
      />
    </DropdownFocusContext.Provider>
  );
}
export const DropdownMenuTrigger = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Trigger>
>(function DropdownMenuTrigger({ onPointerDown, onKeyDown, ...props }, ref) {
  const focusPolicy = useContext(DropdownFocusContext);
  return (
    <DropdownMenuPrimitive.Trigger
      {...props}
      ref={focusPolicy?.composeTriggerRef(ref) ?? ref}
      onPointerDown={(event) => {
        focusPolicy?.markPointerOpen();
        onPointerDown?.(event);
      }}
      onKeyDown={(event) => {
        focusPolicy?.markKeyboardOpen(event.key);
        onKeyDown?.(event);
      }}
    />
  );
});

export function dropdownMenuItemClassName({
  disabled = false,
  className,
}: {
  disabled?: boolean;
  className?: string;
} = {}) {
  return cn(
    "flex min-h-[40px] w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors",
    "text-content-primary hover:bg-warm-muted/75",
    "focus-visible:bg-warm-muted/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand",
    "data-[highlighted]:outline-none",
    disabled && "cursor-not-allowed opacity-45",
    className,
  );
}

export const DropdownMenuContent = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(function DropdownMenuContent(
  {
    className,
    sideOffset = 8,
    collisionPadding = 12,
    onCloseAutoFocus,
    onFocusCapture,
    onFocusOutside,
    ...props
  },
  ref,
) {
  const focusPolicy = useContext(DropdownFocusContext);
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event);
          focusPolicy?.handleCloseAutoFocus(event);
        }}
        onFocusCapture={(event) => {
          onFocusCapture?.(event);
          if (!event.defaultPrevented)
            focusPolicy?.handleContentFocusCapture(event);
        }}
        onFocusOutside={(event) => {
          onFocusOutside?.(event);
          focusPolicy?.handleFocusOutside(event);
        }}
        className={cn(
          "z-[80] rounded-2xl border border-overlay-border bg-overlay-surface p-1.5 text-content-primary shadow-overlay",
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
});

export const DropdownMenuItem = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.Item>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item>
>(function DropdownMenuItem({ className, disabled, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Item
      ref={ref}
      disabled={disabled}
      className={dropdownMenuItemClassName({ disabled, className })}
      {...props}
    />
  );
});
