import { createContext, useContext, type ReactNode } from 'react';
import type { CustomActionDefinition } from '@clash/shared-types';

const CustomActionsContext = createContext<readonly CustomActionDefinition[]>([]);

export function CustomActionsProvider({
    actions,
    children,
}: {
    actions: readonly CustomActionDefinition[];
    children: ReactNode;
}) {
    return (
        <CustomActionsContext.Provider value={actions}>
            {children}
        </CustomActionsContext.Provider>
    );
}

export function useProjectCustomActions(): readonly CustomActionDefinition[] {
    return useContext(CustomActionsContext);
}
