/* eslint-disable @next/next/no-img-element */

import { X } from "@phosphor-icons/react";
import { Dialog } from "./ui/dialog";
import { IconButton } from "./ui/icon-button";

interface MediaViewerProps {
  isOpen: boolean;
  onClose: () => void;
  type: "image" | "video";
  src: string;
  title?: string;
}

export default function MediaViewer({
  isOpen,
  onClose,
  type,
  src,
  title,
}: MediaViewerProps) {
  const accessibleName = title || "Media Viewer";

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      ariaLabel={accessibleName}
      size="auto"
      hideCloseButton
      unstyled
      overlayClassName="z-[100] clash-media-viewer-backdrop"
      containerClassName="z-[100] p-4"
      contentClassName="flex max-h-[90vh] max-w-[90vw] flex-col items-center justify-center rounded-2xl bg-transparent p-4"
    >
      {/* Close Button */}
      <IconButton
        label="Close media viewer"
        onClick={onClose}
        icon={<X size={24} weight="bold" />}
        size="lg"
        shape="circle"
        className="clash-media-viewer-chrome absolute -top-14 right-0 text-slate-900 hover:text-brand focus-visible:ring-offset-warm-page"
      />

      {/* Title */}
      {title && (
        <div className="clash-media-viewer-chrome absolute -top-14 left-0 max-w-[calc(90vw-64px)] truncate rounded-full px-4 py-2 text-sm font-medium text-slate-900">
          {title}
        </div>
      )}

      {/* Media Content */}
      <div className="clash-media-viewer-frame overflow-hidden rounded-2xl p-1">
        {type === "image" ? (
          <img
            src={src}
            alt={accessibleName}
            className="block max-h-[80vh] max-w-[85vw] rounded-xl object-contain"
          />
        ) : (
          <video
            src={src}
            controls
            autoPlay
            className="block max-h-[80vh] max-w-[85vw] rounded-xl bg-stone-950"
          />
        )}
      </div>
    </Dialog>
  );
}
