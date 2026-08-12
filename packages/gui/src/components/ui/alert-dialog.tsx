import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
  type ReactNode,
} from "react";
import { motion } from "framer-motion";
import { AlertDialog as AlertDialogPrimitive } from "radix-ui";

import { cn } from "../../lib/cn";

export const AlertDialog = AlertDialogPrimitive.Root;
export const AlertDialogAction = AlertDialogPrimitive.Action;
export const AlertDialogCancel = AlertDialogPrimitive.Cancel;
export const AlertDialogTitle = AlertDialogPrimitive.Title;
export const AlertDialogDescription = AlertDialogPrimitive.Description;

interface AlertDialogSurfaceProps
  extends ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content> {
  children: ReactNode;
  overlayClassName?: string;
  containerClassName?: string;
  surfaceClassName?: string;
}

export const AlertDialogSurface = forwardRef<
  ElementRef<typeof AlertDialogPrimitive.Content>,
  AlertDialogSurfaceProps
>(function AlertDialogSurface(
  {
    children,
    overlayClassName,
    containerClassName,
    surfaceClassName,
    ...contentProps
  },
  ref,
) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay asChild>
        <motion.div
          className={cn(
            "clash-confirm-dialog-backdrop fixed inset-0 z-[10000]",
            overlayClassName,
          )}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.12 }}
        />
      </AlertDialogPrimitive.Overlay>
      <motion.div
        className={cn(
          "fixed inset-0 z-[10000] flex items-center justify-center p-4",
          containerClassName,
        )}
      >
        <AlertDialogPrimitive.Content ref={ref} asChild {...contentProps}>
          <motion.div
            className={cn(
              "clash-confirm-dialog-surface relative w-full max-w-sm overflow-hidden rounded-2xl",
              surfaceClassName,
            )}
            initial={{ y: 8, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            {children}
          </motion.div>
        </AlertDialogPrimitive.Content>
      </motion.div>
    </AlertDialogPrimitive.Portal>
  );
});
