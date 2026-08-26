import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { Avatar as AvatarPrimitive } from "radix-ui";

import { cn } from "../../lib/cn";

export type AvatarSize = "sm" | "default" | "lg";
export type AvatarRootProps = ComponentPropsWithoutRef<typeof AvatarPrimitive.Root> & {
  size?: AvatarSize;
};

export const AvatarRoot = forwardRef<
  ElementRef<typeof AvatarPrimitive.Root>,
  AvatarRootProps
>(function AvatarRoot({ className, size = "default", ...props }, ref) {
  return (
    <AvatarPrimitive.Root
      ref={ref}
      data-slot="avatar"
      data-size={size}
      className={cn(
        "group/avatar relative flex size-8 shrink-0 overflow-hidden rounded-full select-none",
        "after:pointer-events-none after:absolute after:inset-0 after:rounded-full after:border after:border-border",
        "data-[size=sm]:size-6 data-[size=lg]:size-10",
        className,
      )}
      {...props}
    />
  );
});

export const AvatarImage = forwardRef<
  ElementRef<typeof AvatarPrimitive.Image>,
  ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(function AvatarImage({ className, ...props }, ref) {
  return (
    <AvatarPrimitive.Image
      ref={ref}
      data-slot="avatar-image"
      className={cn("aspect-square size-full rounded-full object-cover", className)}
      {...props}
    />
  );
});

export const AvatarFallback = forwardRef<
  ElementRef<typeof AvatarPrimitive.Fallback>,
  ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(function AvatarFallback({ className, ...props }, ref) {
  return (
    <AvatarPrimitive.Fallback
      ref={ref}
      data-slot="avatar-fallback"
      className={cn(
        "flex size-full items-center justify-center rounded-full bg-muted text-sm text-muted-foreground",
        "group-data-[size=sm]/avatar:text-xs",
        className,
      )}
      {...props}
    />
  );
});
