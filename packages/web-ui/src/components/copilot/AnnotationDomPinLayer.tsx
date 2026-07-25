import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trash } from "@phosphor-icons/react";
import type {
  AgentAnnotationDraft,
  AgentAnnotationSurface,
} from "@clash/shared-types";
import { annotationLocateSelector } from "@clash/web-ui/lib/agentAnnotationLocate";

/**
 * In-place note editor card shared by the canvas pin layer (viewport-portal
 * positioned) and the DOM pin layer below. Positioning is the caller's job.
 */
export function AnnotationNoteEditor({
  number,
  note,
  onChangeNote,
  onRemove,
  onClose,
}: {
  number: number;
  note: string;
  onChangeNote: (note: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const focusAtEnd = useCallback((editor: HTMLTextAreaElement | null) => {
    if (!editor) return;
    editor.focus();
    const end = editor.value.length;
    editor.setSelectionRange(end, end);
  }, []);

  return (
    <div
      data-agent-annotation-inline-editor=""
      className="w-64 rounded-xl border border-warm-border/90 bg-warm-surface p-2 shadow-[0_1px_2px_rgba(35,31,25,0.05),0_10px_28px_rgba(35,31,25,0.13)] dark:border-warm-border dark:bg-warm-surface"
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <textarea
        ref={focusAtEnd}
        aria-label={`Annotation ${number} note`}
        value={note}
        placeholder="What should the agent inspect or change?"
        rows={2}
        onChange={(event) => onChangeNote(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            onClose();
          }
        }}
        className="block min-h-12 w-full resize-none border-0 bg-transparent p-1 text-[13px] leading-5 text-slate-900 outline-none placeholder:text-stone-400 dark:text-slate-100 dark:placeholder:text-stone-500"
      />
      <div className="mt-1 flex items-center justify-between">
        <button
          type="button"
          aria-label={`Delete annotation ${number}`}
          onClick={onRemove}
          className="flex h-6 w-6 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-400 dark:hover:bg-red-950/40 dark:hover:text-red-400"
        >
          <Trash className="h-3.5 w-3.5" weight="bold" />
        </button>
        <button
          type="button"
          aria-label={`Done editing annotation ${number}`}
          onClick={onClose}
          className="rounded-md px-2 py-0.5 text-[12px] font-medium text-stone-500 transition-colors hover:bg-warm-muted hover:text-slate-900 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand dark:text-stone-400 dark:hover:bg-warm-muted dark:hover:text-neutral-100"
        >
          Done
        </button>
      </div>
    </div>
  );
}

interface DomPin {
  id: string;
  number: number;
  x: number;
  y: number;
  visible: boolean;
  editorX: number;
  editorY: number;
}

const EDITOR_WIDTH = 256;
const EDITOR_HEIGHT_ESTIMATE = 128;

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
 * follow scroll and layout changes. Clicking a pin opens the in-place editor.
 */
export function AgentAnnotationDomPinLayer({
  annotations,
  surface,
  surfaceId,
  editingId,
  onEditingChange,
  onChangeNote,
  onRemove,
}: {
  annotations: readonly AgentAnnotationDraft[];
  surface: AgentAnnotationSurface;
  surfaceId: string;
  editingId: string | null;
  onEditingChange: (annotationId: string | null) => void;
  onChangeNote: (annotationId: string, note: string) => void;
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
        const editorX = Math.max(
          4,
          Math.min(x + 10, layerRect.width - EDITOR_WIDTH - 12),
        );
        const editorY =
          y + 12 + EDITOR_HEIGHT_ESTIMATE > layerRect.height
            ? Math.max(4, y - EDITOR_HEIGHT_ESTIMATE)
            : y + 12;
        return [{ id: annotation.id, number, x, y, visible, editorX, editorY }];
      });
      setPins((current) => (samePins(current, next) ? current : next));
      frame = window.requestAnimationFrame(measure);
    };
    frame = window.requestAnimationFrame(measure);
    return () => window.cancelAnimationFrame(frame);
  }, [relevant]);

  if (relevant.length === 0) return null;

  const editingPin = editingId
    ? (pins.find((pin) => pin.id === editingId) ?? null)
    : null;
  const editingAnnotation = editingPin
    ? (annotations.find((annotation) => annotation.id === editingPin.id) ??
      null)
    : null;

  return (
    <div
      ref={layerRef}
      data-agent-annotation-dom-pin-layer={surface}
      className="pointer-events-none absolute inset-0 z-[72]"
    >
      {pins
        .filter((pin) => pin.visible)
        .map((pin) => (
          <button
            key={pin.id}
            type="button"
            data-agent-annotation-pin=""
            aria-label={`Annotation ${pin.number}`}
            aria-expanded={editingId === pin.id}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onEditingChange(editingId === pin.id ? null : pin.id);
            }}
            className="pointer-events-auto absolute flex h-6 min-w-6 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-semibold leading-none text-white shadow-[0_4px_12px_rgba(215,78,58,0.28)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
            style={{ left: pin.x, top: pin.y }}
          >
            {pin.number}
          </button>
        ))}
      {editingPin?.visible && editingAnnotation ? (
        <div
          className="pointer-events-auto absolute z-[73]"
          style={{ left: editingPin.editorX, top: editingPin.editorY }}
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
    </div>
  );
}
