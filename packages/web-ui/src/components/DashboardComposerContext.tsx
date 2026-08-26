import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  canAddProjectReference,
  dashboardComposerReferencesReducer,
  initialDashboardComposerReferences,
  type DashboardComposerReferencesState,
  type DashboardProjectReference,
  type DashboardSkillReference,
} from "./dashboardComposerReferences";
import { handleDashboardComposerDragEnd } from "./dashboardComposerDnd";
import { DashboardComposerDragOverlay } from "./DashboardComposerDragOverlay";

export interface DashboardComposerContextValue {
  input: string;
  setInput: (input: string) => void;
  references: DashboardComposerReferencesState;
  addProjectReference: (project: DashboardProjectReference) => void;
  selectProjectReference: (project: DashboardProjectReference) => void;
  removeProjectReference: () => void;
  addSkillReference: (skill: DashboardSkillReference) => void;
  removeSkillReference: (skillId: string) => void;
  canAddProjectReference: (projectId: string) => boolean;
  registerComposerFocus: (focus: (() => void) | null) => void;
  focusComposer: () => void;
  clearAfterSubmit: () => void;
}

const DashboardComposerContext =
  createContext<DashboardComposerContextValue | null>(null);

export function DashboardComposerProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [input, setInput] = useState("");
  const [activeDragData, setActiveDragData] = useState<unknown>(null);
  const [references, dispatch] = useReducer(
    dashboardComposerReferencesReducer,
    initialDashboardComposerReferences,
  );
  const focusRef = useRef<(() => void) | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const addProjectReference = useCallback(
    (project: DashboardProjectReference) => {
      dispatch({ type: "add-project", project });
    },
    [],
  );
  const selectProjectReference = useCallback(
    (project: DashboardProjectReference) => {
      dispatch({ type: "select-project", project });
    },
    [],
  );
  const removeProjectReference = useCallback(() => {
    dispatch({ type: "remove-project" });
  }, []);
  const addSkillReference = useCallback((skill: DashboardSkillReference) => {
    dispatch({ type: "add-skill", skill });
  }, []);
  const removeSkillReference = useCallback((skillId: string) => {
    dispatch({ type: "remove-skill", skillId });
  }, []);
  const canAddProject = useCallback(
    (projectId: string) => canAddProjectReference(references, projectId),
    [references],
  );
  const registerComposerFocus = useCallback((focus: (() => void) | null) => {
    focusRef.current = focus;
  }, []);
  const focusComposer = useCallback(() => {
    focusRef.current?.();
  }, []);
  const clearAfterSubmit = useCallback(() => {
    setInput("");
    dispatch({ type: "remove-project" });
    for (const skill of references.skills) {
      dispatch({ type: "remove-skill", skillId: skill.id });
    }
  }, [references.skills]);
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDragData(null);
      void handleDashboardComposerDragEnd(event, {
        addProject: addProjectReference,
      }).catch(() => undefined);
    },
    [addProjectReference],
  );
  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragData(event.active.data.current ?? null);
  }, []);

  const value = useMemo<DashboardComposerContextValue>(
    () => ({
      input,
      setInput,
      references,
      addProjectReference,
      selectProjectReference,
      removeProjectReference,
      addSkillReference,
      removeSkillReference,
      canAddProjectReference: canAddProject,
      registerComposerFocus,
      focusComposer,
      clearAfterSubmit,
    }),
    [
      addProjectReference,
      addSkillReference,
      canAddProject,
      clearAfterSubmit,
      focusComposer,
      input,
      references,
      registerComposerFocus,
      removeProjectReference,
      removeSkillReference,
      selectProjectReference,
    ],
  );

  return (
    <DashboardComposerContext.Provider value={value}>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragCancel={() => setActiveDragData(null)}
        onDragEnd={handleDragEnd}
      >
        {children}
        <DragOverlay dropAnimation={null} zIndex={100}>
          <DashboardComposerDragOverlay data={activeDragData} />
        </DragOverlay>
      </DndContext>
    </DashboardComposerContext.Provider>
  );
}

export function useDashboardComposer(): DashboardComposerContextValue {
  const value = useContext(DashboardComposerContext);
  if (!value) {
    throw new Error(
      "useDashboardComposer must be used inside DashboardComposerProvider",
    );
  }
  return value;
}

export function useOptionalDashboardComposer(): DashboardComposerContextValue | null {
  return useContext(DashboardComposerContext);
}
