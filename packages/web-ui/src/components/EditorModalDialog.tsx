import type { ReactNode } from "react";

import { cn } from "./ai-elements/utils";
import { Dialog } from "./ui/dialog";

interface EditorModalDialogProps {
  open: boolean;
  onClose: () => void;
  ariaLabel: string;
  children: ReactNode;
  panelClassName: string;
  panelTestId?: string;
  closeOnInteractOutside?: boolean;
}

export function EditorModalDialog({
  open,
  onClose,
  ariaLabel,
  children,
  panelClassName,
  panelTestId,
  closeOnInteractOutside = true,
}: EditorModalDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      ariaLabel={ariaLabel}
      size="auto"
      hideCloseButton
      disableBackdropClose={!closeOnInteractOutside}
      unstyled
      overlayClassName="clash-editor-modal-backdrop z-[100] bg-warm-page/75"
      containerClassName="z-[100] px-5 py-4 sm:px-8 sm:py-7"
      contentClassName="max-w-none"
    >
      <div
        data-testid={panelTestId}
        className={cn(
          "clash-editor-modal-surface relative overflow-hidden rounded-2xl",
          panelClassName,
        )}
      >
        {children}
      </div>
    </Dialog>
  );
}
