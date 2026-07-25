
import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import {
    listUserEnabledCanvasModelIds,
    type ModelCatalogEntry,
    type ProviderAccountAvailability,
} from '@clash/shared-types';
import { listModelCatalog, listModelProviders } from '../lib/clientActions';

interface ProjectContextType {
    projectId: string;
    enabledModelCatalog: ModelCatalogEntry[];
    modelCatalogReady: boolean;
}

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

export function enabledModelCatalogEntries(
    entries: ReadonlyArray<ModelCatalogEntry>,
    providers: ProviderAccountAvailability[],
): ModelCatalogEntry[] {
    const enabledIds = new Set(listUserEnabledCanvasModelIds({
        models: entries.map((entry) => entry.model),
        configuredProviders: providers,
    }));
    return entries.filter((entry) => enabledIds.has(entry.model.id));
}

export function ProjectProvider({
    projectId,
    children,
    initialModelCatalog,
}: {
    projectId: string;
    children: ReactNode;
    initialModelCatalog?: ModelCatalogEntry[];
}) {
    const [enabledModelCatalog, setEnabledModelCatalog] = useState<ModelCatalogEntry[]>(initialModelCatalog ?? []);
    const [modelCatalogReady, setModelCatalogReady] = useState(initialModelCatalog !== undefined);

    useEffect(() => {
        if (initialModelCatalog !== undefined) return;
        let cancelled = false;
        setModelCatalogReady(false);
        void Promise.all([listModelCatalog(), listModelProviders()])
            .then(([entries, providers]) => {
                if (!cancelled) setEnabledModelCatalog(enabledModelCatalogEntries(entries, providers));
            })
            .catch(() => {
                if (!cancelled) setEnabledModelCatalog([]);
            })
            .finally(() => {
                if (!cancelled) setModelCatalogReady(true);
            });
        return () => { cancelled = true; };
    }, [initialModelCatalog, projectId]);

    const value = useMemo(
        () => ({ projectId, enabledModelCatalog, modelCatalogReady }),
        [enabledModelCatalog, modelCatalogReady, projectId],
    );
    return (
        <ProjectContext.Provider value={value}>
            {children}
        </ProjectContext.Provider>
    );
}

export function useProject() {
    const context = useContext(ProjectContext);
    if (!context) {
        throw new Error('useProject must be used within ProjectProvider');
    }
    return context;
}
