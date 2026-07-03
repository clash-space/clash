import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { Avatar as AvatarPrimitive } from "radix-ui";

export const AvatarRoot = forwardRef<
  ElementRef<typeof AvatarPrimitive.Root>,
  ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>
>(function AvatarRoot(props, ref) {
  return <AvatarPrimitive.Root ref={ref} data-slot="avatar" {...props} />;
});

export const AvatarImage = forwardRef<
  ElementRef<typeof AvatarPrimitive.Image>,
  ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(function AvatarImage(props, ref) {
  return <AvatarPrimitive.Image ref={ref} data-slot="avatar-image" {...props} />;
});

export const AvatarFallback = forwardRef<
  ElementRef<typeof AvatarPrimitive.Fallback>,
  ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(function AvatarFallback(props, ref) {
  return <AvatarPrimitive.Fallback ref={ref} data-slot="avatar-fallback" {...props} />;
});
