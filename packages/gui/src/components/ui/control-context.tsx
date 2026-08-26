import { createContext, useContext, type ReactNode } from "react";

export type ControlContextName =
  | "default"
  | "settings"
  | "director"
  | "timeline"
  | "composer";

const ControlContext = createContext<ControlContextName>("default");

export function ControlContextProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: ControlContextName;
}) {
  return <ControlContext.Provider value={value}>{children}</ControlContext.Provider>;
}

export function useControlContext() {
  return useContext(ControlContext);
}
