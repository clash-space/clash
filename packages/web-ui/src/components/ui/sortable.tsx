import { useCallback, type CSSProperties, type ReactNode } from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export function reorderItemsById<T extends string>(
  items: readonly T[],
  activeId: string,
  overId: string,
): T[] | null {
  if (activeId === overId) return null;
  const fromIndex = items.indexOf(activeId as T);
  const toIndex = items.indexOf(overId as T);
  if (fromIndex < 0 || toIndex < 0) return null;
  return arrayMove([...items], fromIndex, toIndex);
}

export function moveItem<T>(items: readonly T[], fromIndex: number, toIndex: number): T[] | null {
  if (fromIndex === toIndex) return null;
  if (fromIndex < 0 || fromIndex >= items.length) return null;
  if (toIndex < 0 || toIndex >= items.length) return null;
  return arrayMove([...items], fromIndex, toIndex);
}

export function SortableList({
  items,
  onReorder,
  children,
}: {
  items: readonly string[];
  onReorder: (items: string[]) => void;
  children: ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const handleDragEnd = useCallback(({ active, over }: {
    active: { id: UniqueIdentifier };
    over: { id: UniqueIdentifier } | null;
  }) => {
    if (!over) return;
    const ordered = reorderItemsById(items, String(active.id), String(over.id));
    if (ordered) onReorder(ordered);
  }, [items, onReorder]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={[...items]} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

export function useSortableItem(
  id: string,
  { draggingZIndex }: { draggingZIndex?: number } = {},
) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? draggingZIndex : undefined,
  };

  return {
    setNodeRef,
    style,
    isDragging,
    dragHandleProps: {
      ...attributes,
      ...listeners,
    },
  };
}
