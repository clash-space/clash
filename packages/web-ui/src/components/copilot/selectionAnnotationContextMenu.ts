import type { AgentSelectionAnnotationOverlayHandle } from "./AgentSelectionAnnotationOverlay";

interface SelectionContextMenuEvent {
  currentTarget: HTMLElement;
  preventDefault: () => void;
  stopPropagation: () => void;
}

export function handleSelectionAnnotationContextMenu(
  event: SelectionContextMenuEvent,
  overlayRef: {
    current: AgentSelectionAnnotationOverlayHandle | null;
  },
): boolean {
  const captured =
    overlayRef.current?.captureSelection(event.currentTarget) ?? false;
  if (!captured) return false;

  event.preventDefault();
  event.stopPropagation();
  return true;
}
