import type { AgentAnnotationTarget } from "@clash/shared-types";

export const ANNOTATION_LOCATE_HIGHLIGHT_MS = 3000;

function escapeSelectorValue(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, "\\$&");
}

/**
 * CSS selector for the DOM element that visually represents an annotation
 * target. Canvas objects render as React Flow nodes/edges keyed by data-id;
 * timeline and director objects tag themselves with
 * data-agent-annotation-object-id for the shared right-click annotate flow.
 */
export function annotationLocateSelector(
  target: Pick<AgentAnnotationTarget, "surface" | "objectId" | "objectType">,
): string {
  const objectId = escapeSelectorValue(target.objectId);
  if (target.surface === "canvas") {
    return target.objectType === "canvas-edge"
      ? `.react-flow__edge[data-id="${objectId}"]`
      : `.react-flow__node[data-id="${objectId}"]`;
  }
  return `[data-agent-annotation-object-id="${objectId}"]`;
}

/**
 * Draws a temporary brand-colored ring around the located element, then
 * restores its previous inline styles after ANNOTATION_LOCATE_HIGHLIGHT_MS.
 */
export function flashAnnotationLocateHighlight(
  element: HTMLElement,
  durationMs = ANNOTATION_LOCATE_HIGHLIGHT_MS,
): void {
  const previous = {
    outline: element.style.outline,
    outlineOffset: element.style.outlineOffset,
    boxShadow: element.style.boxShadow,
    transition: element.style.transition,
  };
  element.style.transition = "outline-color 240ms ease, box-shadow 240ms ease";
  element.style.outline = "2px solid rgba(215, 78, 58, 0.95)";
  element.style.outlineOffset = "3px";
  element.style.boxShadow = "0 0 0 6px rgba(215, 78, 58, 0.18)";
  window.setTimeout(() => {
    element.style.outline = previous.outline;
    element.style.outlineOffset = previous.outlineOffset;
    element.style.boxShadow = previous.boxShadow;
    element.style.transition = previous.transition;
  }, durationMs);
}
