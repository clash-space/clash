import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";

interface PluginViewContextValue {
  openView: (nodeId: string) => void;
}

const PluginViewContext = createContext<PluginViewContextValue | undefined>(undefined);

export function PluginViewProvider({
  children,
  onOpenView,
}: {
  children: ReactNode;
  onOpenView: (nodeId: string) => void;
}) {
  const openView = useCallback((nodeId: string) => {
    if (nodeId) onOpenView(nodeId);
  }, [onOpenView]);
  const value = useMemo(() => ({ openView }), [openView]);
  return <PluginViewContext.Provider value={value}>{children}</PluginViewContext.Provider>;
}

export function usePluginView() {
  const context = useContext(PluginViewContext);
  if (!context) throw new Error("usePluginView must be used within PluginViewProvider");
  return context;
}
