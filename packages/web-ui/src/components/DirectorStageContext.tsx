import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";

interface DirectorStageContextValue {
  openDirectorStage: (stageId: string) => void;
}

const DirectorStageContext = createContext<DirectorStageContextValue | undefined>(
  undefined,
);

export function DirectorStageProvider({
  children,
  onOpenDirectorStage,
}: {
  children: ReactNode;
  onOpenDirectorStage: (stageId: string) => void;
}) {
  const openDirectorStage = useCallback(
    (stageId: string) => {
      if (stageId) onOpenDirectorStage(stageId);
    },
    [onOpenDirectorStage],
  );
  const value = useMemo(() => ({ openDirectorStage }), [openDirectorStage]);
  return (
    <DirectorStageContext.Provider value={value}>
      {children}
    </DirectorStageContext.Provider>
  );
}

export function useDirectorStage() {
  const context = useContext(DirectorStageContext);
  if (!context) {
    throw new Error("useDirectorStage must be used within DirectorStageProvider");
  }
  return context;
}
