import type { ReactNode } from "react";

import { cn } from "../ai-elements/utils";
import { Dialog } from "../ui/dialog";

interface NodeModalDialogProps {
  open: boolean;
  onClose: () => void;
  ariaLabel: string;
  children: ReactNode;
  contentClassName?: string;
  overlayClassName?: string;
}

export function NodeModalDialog({
  open,
  onClose,
  ariaLabel,
  children,
  contentClassName,
  overlayClassName,
}: NodeModalDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      ariaLabel={ariaLabel}
      size="auto"
      hideCloseButton
      unstyled
      overlayClassName={cn("z-[9999] bg-warm-page/80", overlayClassName)}
      containerClassName="z-[9999] p-8"
      contentClassName={cn(
        "w-full max-w-5xl h-[85vh] bg-warm-surface rounded-xl shadow-lg overflow-hidden flex flex-col border border-warm-border",
        contentClassName,
      )}
    >
      {children}
    </Dialog>
  );
}
