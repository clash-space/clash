import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";

export type CanvasTransientUiKind = "action-panel" | "node-menu";

type CanvasTransientUiOwner = {
  kind: CanvasTransientUiKind;
  id: string;
};

export type CanvasTransientUiStore = {
  dismiss: () => void;
  close: (kind: CanvasTransientUiKind, id: string) => void;
  isOpen: (kind: CanvasTransientUiKind, id: string) => boolean;
  open: (kind: CanvasTransientUiKind, id: string) => void;
  subscribe: (listener: () => void) => () => void;
};

export function createCanvasTransientUiStore(): CanvasTransientUiStore {
  let owner: CanvasTransientUiOwner | null = null;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());

  return {
    dismiss() {
      if (!owner) return;
      owner = null;
      emit();
    },
    close(kind, id) {
      if (owner?.kind !== kind || owner.id !== id) return;
      owner = null;
      emit();
    },
    isOpen(kind, id) {
      return owner?.kind === kind && owner.id === id;
    },
    open(kind, id) {
      if (owner?.kind === kind && owner.id === id) return;
      owner = { kind, id };
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const CanvasTransientUiContext = createContext<CanvasTransientUiStore | null>(null);

export function CanvasTransientUiProvider({
  children,
  store,
}: {
  children: ReactNode;
  store?: CanvasTransientUiStore;
}) {
  const localStoreRef = useRef<CanvasTransientUiStore | null>(null);
  if (!localStoreRef.current) {
    localStoreRef.current = createCanvasTransientUiStore();
  }

  return (
    <CanvasTransientUiContext.Provider value={store ?? localStoreRef.current}>
      {children}
    </CanvasTransientUiContext.Provider>
  );
}

export function useCanvasTransientUiOwner(
  kind: CanvasTransientUiKind,
  id: string,
) {
  const store = useContext(CanvasTransientUiContext);
  if (!store) {
    throw new Error(
      "useCanvasTransientUiOwner must be used within CanvasTransientUiProvider",
    );
  }

  const isOpen = useSyncExternalStore(
    store.subscribe,
    () => store.isOpen(kind, id),
    () => false,
  );
  const open = useCallback(() => store.open(kind, id), [id, kind, store]);
  const close = useCallback(() => store.close(kind, id), [id, kind, store]);
  const toggle = useCallback(() => {
    if (store.isOpen(kind, id)) store.close(kind, id);
    else store.open(kind, id);
  }, [id, kind, store]);

  useEffect(
    () => () => store.close(kind, id),
    [id, kind, store],
  );

  return { close, isOpen, open, toggle };
}
