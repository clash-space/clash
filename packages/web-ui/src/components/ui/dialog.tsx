import { type ReactNode } from "react";
import { motion } from "framer-motion";
import { X } from "@phosphor-icons/react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { cn } from "../ai-elements/utils";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  /** Heading text rendered as h2 and wired to aria-labelledby.
   *  Optional: if absent, the dialog renders no header chrome (close
   *  button still shown unless hidden). In that mode the caller MUST
   *  pass `ariaLabel` so the dialog still has an accessible name. */
  title?: string;
  /** Required when `title` is absent — becomes the dialog's aria-label. */
  ariaLabel?: string;
  /** Optional supporting copy below the title. Wired to aria-describedby. */
  description?: ReactNode;
  children: ReactNode;
  /** Max width preset. sm=420, md=520, lg=640, xl=full-content, auto=caller-owned. Default md. */
  size?: "sm" | "md" | "lg" | "xl" | "auto";
  /** Hide the top-right close X. Default false (shown). */
  hideCloseButton?: boolean;
  /** Disable backdrop-click-to-close (Escape still works). Default false. */
  disableBackdropClose?: boolean;
  /** Strip the rounded card chrome — caller owns its own layout
   *  (sidebar + content, etc). Default false. */
  unstyled?: boolean;
  /** Optional class hooks for canvas-layer dialogs that need a different z-index or sizing. */
  overlayClassName?: string;
  containerClassName?: string;
  contentClassName?: string;
}

const sizeClasses = {
  auto: "",
  sm: "w-[420px]",
  md: "w-[520px]",
  lg: "w-[640px]",
  xl: "w-full max-w-5xl h-[min(720px,85vh)]",
};

/**
 * App-wide modal dialog. Radix owns the modal a11y wiring (role=dialog,
 * aria-modal, focus trap, Escape, outside interaction, focus restoration) so
 * callers don't have to remember each piece.
 *
 * Pattern: spring-scale entry + backdrop fade. Backdrop click closes by
 * default; Escape always closes. Returns focus to the previously focused
 * element on close.
 */
export function Dialog({
  open,
  onClose,
  title,
  ariaLabel,
  description,
  children,
  size = "md",
  hideCloseButton = false,
  disableBackdropClose = false,
  unstyled = false,
  overlayClassName,
  containerClassName,
  contentClassName,
}: DialogProps) {
  if (process.env.NODE_ENV !== "production" && !title && !ariaLabel) {
    // eslint-disable-next-line no-console
    console.warn(
      "<Dialog> needs either `title` or `ariaLabel` for an accessible name.",
    );
  }

  const accessibleTitle = title ?? ariaLabel;

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay asChild>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.15 }}
            className={cn(
              "fixed inset-0 z-[70] bg-warm-page/75 backdrop-blur-sm",
              overlayClassName,
            )}
          />
        </DialogPrimitive.Overlay>
        <motion.div
          className={cn(
            "fixed inset-0 z-[70] flex items-center justify-center p-4",
            containerClassName,
          )}
        >
          <DialogPrimitive.Content
            asChild
            {...(!description ? { "aria-describedby": undefined } : undefined)}
            onInteractOutside={(event) => {
              if (disableBackdropClose) event.preventDefault();
            }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 340, damping: 32 }}
              className={cn(
                unstyled
                  ? `relative ${sizeClasses[size]} max-w-[92vw] focus:outline-none`
                  : `relative ${sizeClasses[size]} max-w-[92vw] max-h-[85vh] overflow-y-auto rounded-2xl bg-warm-surface border border-warm-border shadow-lg p-6 focus:outline-none`,
                contentClassName,
              )}
            >
              {!hideCloseButton && !unstyled && (
                <DialogPrimitive.Close asChild>
                  <button
                    type="button"
                    aria-label="Close"
                    className="absolute top-3 right-3 p-2 min-h-[36px] min-w-[36px] rounded-md text-stone-700 hover:text-stone-900 hover:bg-warm-muted transition-colors dark:text-stone-300 dark:hover:text-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-warm-surface"
                  >
                    <X className="w-4 h-4" weight="bold" aria-hidden="true" />
                  </button>
                </DialogPrimitive.Close>
              )}
              {accessibleTitle ? (
                <DialogPrimitive.Title
                  className={
                    title
                      ? "font-display text-lg font-bold text-slate-900 mb-1 dark:text-slate-50 pr-8"
                      : "sr-only"
                  }
                >
                  {accessibleTitle}
                </DialogPrimitive.Title>
              ) : null}
              {description && (
                <DialogPrimitive.Description asChild>
                  <div className="text-sm text-stone-700 mb-5 dark:text-stone-300">
                    {description}
                  </div>
                </DialogPrimitive.Description>
              )}
              {children}
            </motion.div>
          </DialogPrimitive.Content>
        </motion.div>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
