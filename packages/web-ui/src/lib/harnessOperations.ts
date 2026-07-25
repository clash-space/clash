import { useSyncExternalStore } from "react";

export type HarnessOperationAction =
  "toggle" | "probe" | "install" | "uninstall" | "upgrade" | "auth";

export type HarnessOperationsSnapshot = Readonly<
  Record<string, HarnessOperationAction>
>;

let snapshot: HarnessOperationsSnapshot = Object.freeze({});
const listeners = new Set<() => void>();

function publish(next: HarnessOperationsSnapshot) {
  snapshot = Object.freeze(next);
  for (const listener of listeners) listener();
}

export function setHarnessOperation(
  harnessId: string,
  action: HarnessOperationAction,
) {
  if (snapshot[harnessId] === action) return;
  publish({ ...snapshot, [harnessId]: action });
}

export function clearHarnessOperation(
  harnessId: string,
  expectedAction?: HarnessOperationAction,
) {
  if (
    !(harnessId in snapshot) ||
    (expectedAction && snapshot[harnessId] !== expectedAction)
  ) {
    return;
  }
  const { [harnessId]: _removed, ...rest } = snapshot;
  publish(rest);
}

export function subscribeHarnessOperations(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getHarnessOperationsSnapshot() {
  return snapshot;
}

export function useHarnessOperations() {
  return useSyncExternalStore(
    subscribeHarnessOperations,
    getHarnessOperationsSnapshot,
    getHarnessOperationsSnapshot,
  );
}
