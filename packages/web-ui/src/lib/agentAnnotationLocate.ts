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

/** Centers a located target, waits for that movement to finish, then highlights. */
export function centerAndHighlightAnnotationTarget(
  element: HTMLElement,
  center: () => void | Promise<unknown> = () => {
    element.scrollIntoView({
      behavior: "auto",
      block: "center",
      inline: "center",
    });
  },
): void {
  void Promise.resolve(center()).then(() => {
    window.requestAnimationFrame(() => {
      flashAnnotationLocateHighlight(element);
    });
  });
}

/**
 * Temporarily emphasizes the located element without stacking visual frames.
 * Browser annotations already own a border, so locating them strengthens the
 * existing fill. Other workspace targets receive one outline.
 */
export function flashAnnotationLocateHighlight(
  element: HTMLElement,
  durationMs = ANNOTATION_LOCATE_HIGHLIGHT_MS,
): void {
  const reusesAnnotationFrame = element.hasAttribute(
    "data-browser-annotation-marker",
  );
  const previous = {
    outline: element.style.outline,
    outlineOffset: element.style.outlineOffset,
    backgroundColor: element.style.backgroundColor,
    transition: element.style.transition,
  };
  if (reusesAnnotationFrame) {
    element.style.transition = "background-color 180ms ease";
    element.style.backgroundColor = "rgba(215, 78, 58, 0.24)";
  } else {
    element.style.transition = "outline-color 180ms ease";
    element.style.outline = "2px solid rgba(215, 78, 58, 0.95)";
    element.style.outlineOffset = "3px";
  }
  window.setTimeout(() => {
    element.style.outline = previous.outline;
    element.style.outlineOffset = previous.outlineOffset;
    element.style.backgroundColor = previous.backgroundColor;
    element.style.transition = previous.transition;
  }, durationMs);
}
