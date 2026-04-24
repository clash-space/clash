
import { createContext, useContext } from 'react';

export type LayoutActions = {
    relayoutParent: (parentId: string | undefined) => void;
};

const LayoutActionsContext = createContext<LayoutActions | null>(null);

export function LayoutActionsProvider({
    value,
    children,
}: {
    value: LayoutActions;
    children: React.ReactNode;
}) {
    return <LayoutActionsContext.Provider value={value}>{children}</LayoutActionsContext.Provider>;
}

export function useLayoutActions(): LayoutActions {
    const ctx = useContext(LayoutActionsContext);
    if (!ctx) {
        throw new Error('useLayoutActions must be used within a LayoutActionsProvider');
    }
    return ctx;
}

