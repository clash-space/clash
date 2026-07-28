import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";

interface TextNodeEditorContextValue {
  openEditor: (nodeId: string) => void;
}

const TextNodeEditorContext =
  createContext<TextNodeEditorContextValue | null>(null);

export function TextNodeEditorProvider({
  onOpenNode,
  children,
}: {
  onOpenNode: (nodeId: string) => void;
  children: ReactNode;
}) {
  const value = useMemo<TextNodeEditorContextValue>(
    () => ({
      openEditor: onOpenNode,
    }),
    [onOpenNode],
  );

  return (
    <TextNodeEditorContext.Provider value={value}>
      {children}
    </TextNodeEditorContext.Provider>
  );
}

export function useOptionalTextNodeEditorContext() {
  return useContext(TextNodeEditorContext);
}
