
import { createContext, useContext, ReactNode } from 'react';

interface ProjectContextType {
    projectId: string;
}

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

export function ProjectProvider({ projectId, children }: { projectId: string; children: ReactNode }) {
    return (
        <ProjectContext.Provider value={{ projectId }}>
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
