import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ViewportPortal, useViewport } from "@xyflow/react";
import type { AgentAnnotationDraft } from "@clash/shared-types";
import { annotationLocateSelector } from "@clash/web-ui/lib/agentAnnotationLocate";

import { AnnotationNoteEditor } from "./AnnotationDomPinLayer";
import { projectCanvasAnnotationPin } from "./canvasAnnotationPins";

const EDITOR_WIDTH = 256;
const EDITOR_HEIGHT_ESTIMATE = 128;

interface CanvasPin {
  id: string;
  number: number;
  x: number;
  y: number;
  visible: boolean;
  editorX: number;
  editorY: number;
}

function samePins(a: CanvasPin[], b: CanvasPin[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((pin, index) => {
    const next = b[index];
    return (
      pin.id === next.id &&
      pin.number === next.number &&
      pin.visible === next.visible &&
      Math.abs(pin.x - next.x) < 0.5 &&
      Math.abs(pin.y - next.y) < 0.5 &&
      Math.abs(pin.editorX - next.editorX) < 0.5 &&
      Math.abs(pin.editorY - next.editorY) < 0.5
    );
  });
}

/**
 * Canvas object pins live in React Flow's viewport instead of the outer
 * workspace overlay. This prevents a second layout coordinate system from
 * shifting pins into the copilot pane after the canvas is panned or resized.
 */
export function CanvasAnnotationPinLayer({
  annotations,
  canvasId,
  flowBoundsRef,
  editingId,
  onEditingChange,
  onChangeNote,
  onRemove,
}: {
  annotations: readonly AgentAnnotationDraft[];
  canvasId: string;
  flowBoundsRef: RefObject<HTMLDivElement | null>;
  editingId: string | null;
  onEditingChange: (annotationId: string | null) => void;
  onChangeNote: (annotationId: string, note: string) => void;
  onRemove: (annotationId: string) => void;
}) {
  const viewport = useViewport();
  const [pins, setPins] = useState<CanvasPin[]>([]);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  const relevant = useMemo(
    () =>
      annotations.flatMap((annotation, index) => {
        const { target } = annotation;
        if (
          target.surface !== "canvas" ||
          target.surfaceId !== canvasId ||
          target.selection?.visualRects?.length
        ) {
          return [];
        }
        return [{ annotation, number: index + 1 }];
      }),
    [annotations, canvasId],
  );

  useEffect(() => {
    if (relevant.length === 0) {
      setPins((current) => (current.length > 0 ? [] : current));
      return undefined;
    }

    let frame = 0;
    const measure = () => {
      const flowBounds = flowBoundsRef.current?.getBoundingClientRect();
      if (!flowBounds) return;
      const next = relevant.flatMap(({ annotation, number }) => {
        const element = document.querySelector<HTMLElement>(
          annotationLocateSelector(annotation.target),
        );
        if (!element) return [];
        const rect = element.getBoundingClientRect();
        const currentViewport = viewportRef.current;
        const pin = projectCanvasAnnotationPin({
          targetRect: rect,
          flowRect: flowBounds,
          viewport: currentViewport,
        });
        const visible =
          rect.bottom > flowBounds.top + 2 &&
          rect.top < flowBounds.bottom - 2 &&
          rect.right > flowBounds.left + 2 &&
          rect.left < flowBounds.right - 2;
        const editorScreenX = Math.max(
          4,
          Math.min(pin.screenX + 10, flowBounds.width - EDITOR_WIDTH - 12),
        );
        const editorScreenY =
          pin.screenY + 12 + EDITOR_HEIGHT_ESTIMATE > flowBounds.height
            ? Math.max(4, pin.screenY - EDITOR_HEIGHT_ESTIMATE)
            : pin.screenY + 12;
        const zoom = Math.max(currentViewport.zoom, Number.EPSILON);
        return [
          {
            id: annotation.id,
            number,
            x: pin.x,
            y: pin.y,
            visible,
            editorX: (editorScreenX - currentViewport.x) / zoom,
            editorY: (editorScreenY - currentViewport.y) / zoom,
          },
        ];
      });
      setPins((current) => (samePins(current, next) ? current : next));
      frame = window.requestAnimationFrame(measure);
    };

    measure();
    return () => window.cancelAnimationFrame(frame);
  }, [flowBoundsRef, relevant, viewport.x, viewport.y, viewport.zoom]);

  const editingPin = editingId
    ? (pins.find((pin) => pin.id === editingId) ?? null)
    : null;
  const editingAnnotation = editingPin
    ? (annotations.find((annotation) => annotation.id === editingPin.id) ??
      null)
    : null;
  const inverseZoom = 1 / Math.max(viewport.zoom, Number.EPSILON);

  if (relevant.length === 0) return null;

  return (
    <ViewportPortal>
      {pins
        .filter((pin) => pin.visible)
        .map((pin) => (
          <button
            key={pin.id}
            type="button"
            data-agent-annotation-canvas-pin=""
            aria-label={`Annotation ${pin.number}`}
            aria-expanded={editingId === pin.id}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onEditingChange(editingId === pin.id ? null : pin.id);
            }}
            className="nodrag nopan nowheel pointer-events-auto absolute flex h-6 min-w-6 cursor-pointer items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-semibold leading-none text-white shadow-[0_4px_12px_rgba(215,78,58,0.28)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
            style={{
              left: pin.x,
              top: pin.y,
              zIndex: 10000,
              transform: `translate(-50%, -50%) scale(${inverseZoom})`,
            }}
          >
            {pin.number}
          </button>
        ))}
      {editingPin?.visible && editingAnnotation ? (
        <div
          className="nodrag nopan nowheel pointer-events-auto absolute"
          style={{
            left: editingPin.editorX,
            top: editingPin.editorY,
            zIndex: 10001,
            transform: `scale(${inverseZoom})`,
            transformOrigin: "top left",
          }}
        >
          <AnnotationNoteEditor
            number={editingPin.number}
            note={editingAnnotation.note}
            onChangeNote={(note) => onChangeNote(editingAnnotation.id, note)}
            onRemove={() => onRemove(editingAnnotation.id)}
            onClose={() => onEditingChange(null)}
          />
        </div>
      ) : null}
    </ViewportPortal>
  );
}
