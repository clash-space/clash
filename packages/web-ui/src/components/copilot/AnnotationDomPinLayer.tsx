import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentAnnotationDraft,
  AgentAnnotationSurface,
} from "@clash/shared-types";
import { annotationLocateSelector } from "@clash/web-ui/lib/agentAnnotationLocate";
import { AgentAnnotationActionsContextMenu } from "./AgentAnnotationBlock";

interface DomPin {
  id: string;
  number: number;
  x: number;
  y: number;
  visible: boolean;
}

function samePins(a: DomPin[], b: DomPin[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const previous = a[index];
    const next = b[index];
    if (
      previous.id !== next.id ||
      previous.number !== next.number ||
      previous.visible !== next.visible ||
      Math.abs(previous.x - next.x) > 0.5 ||
      Math.abs(previous.y - next.y) > 0.5
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Numbered pins for object-level annotations on DOM-based surfaces (Timeline,
 * Director Stage). Anchors to the annotated element via its
 * data-agent-annotation-object-id tag and re-measures every frame so pins
 * follow scroll and layout changes. Clicking a pin opens the shared inspector.
 */
export function AgentAnnotationDomPinLayer({
  annotations,
  surface,
  surfaceId,
  activeId,
  onSelect,
  onLocate,
  onRemove,
}: {
  annotations: readonly AgentAnnotationDraft[];
  surface: AgentAnnotationSurface;
  surfaceId: string;
  activeId: string | null;
  onSelect: (annotationId: string) => void;
  onLocate?: (annotationId: string) => void;
  onRemove: (annotationId: string) => void;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [pins, setPins] = useState<DomPin[]>([]);

  // Selection annotations draw their own numbered pins in the selection
  // overlay; this layer covers the object-level ones.
  const relevant = useMemo(
    () =>
      annotations.flatMap((annotation, index) => {
        const { target } = annotation;
        if (
          target.surface !== surface ||
          target.surfaceId !== surfaceId ||
          target.selection?.visualRects?.length
        ) {
          return [];
        }
        return [{ annotation, number: index + 1 }];
      }),
    [annotations, surface, surfaceId],
  );

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer || relevant.length === 0) {
      setPins((current) => (current.length > 0 ? [] : current));
      return undefined;
    }
    let frame = 0;
    const measure = () => {
      const layerRect = layer.getBoundingClientRect();
      const next = relevant.flatMap(({ annotation, number }) => {
        const element = document.querySelector<HTMLElement>(
          annotationLocateSelector(annotation.target),
        );
        if (!element) return [];
        const rect = element.getBoundingClientRect();
        const x = rect.right - layerRect.left;
        const y = rect.top - layerRect.top;
        const visible =
          rect.bottom > layerRect.top + 2 &&
          rect.top < layerRect.bottom - 2 &&
          rect.right > layerRect.left + 2 &&
          rect.left < layerRect.right - 2;
        return [{ id: annotation.id, number, x, y, visible }];
      });
      setPins((current) => (samePins(current, next) ? current : next));
      frame = window.requestAnimationFrame(measure);
    };
    frame = window.requestAnimationFrame(measure);
    return () => window.cancelAnimationFrame(frame);
  }, [relevant]);

  if (relevant.length === 0) return null;

  return (
    <div
      ref={layerRef}
      data-agent-annotation-dom-pin-layer={surface}
      className="pointer-events-none absolute inset-0 z-[72]"
    >
      {pins
        .filter((pin) => pin.visible)
        .map((pin) => {
          const annotation = relevant.find(
            (candidate) => candidate.annotation.id === pin.id,
          )?.annotation;
          if (!annotation) return null;
          return (
            <AgentAnnotationActionsContextMenu
              key={pin.id}
              annotation={annotation}
              onOpen={() => onSelect(pin.id)}
              onLocate={onLocate ? () => onLocate(pin.id) : undefined}
              onRemove={() => onRemove(pin.id)}
            >
              <button
                type="button"
                data-agent-annotation-pin=""
                aria-label={`Annotation ${pin.number}`}
                aria-pressed={activeId === pin.id}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect(pin.id);
                }}
                className={`pointer-events-auto absolute flex h-6 min-w-6 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-semibold leading-none text-white shadow-[0_4px_12px_rgba(215,78,58,0.28)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 ${
                  activeId === pin.id
                    ? "ring-2 ring-white ring-offset-2 ring-offset-brand"
                    : ""
                }`}
                style={{ left: pin.x, top: pin.y }}
              >
                {pin.number}
              </button>
            </AgentAnnotationActionsContextMenu>
          );
        })}
    </div>
  );
}
