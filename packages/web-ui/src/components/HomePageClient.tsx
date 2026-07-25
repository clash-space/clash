
import { useCallback } from 'react';
import type { Project } from '@clash/web-ui/lib/types';
import { createProject } from '@clash/web-ui/lib/clientActions';
import HeroSection from './HeroSection';
import RecentProjects from './RecentProjects';

interface HomePageClientProps {
    initialProjects: Project[];
}

export default function HomePageClient({ initialProjects }: HomePageClientProps) {
    const handleCreateProject = useCallback(async (projectName: string) => {
        await createProject(projectName, { startFromPrompt: false });
    }, []);

    return (
        <div className="text-slate-950 dark:text-slate-50">
            <HeroSection />
            <RecentProjects projects={initialProjects} onCreateProject={handleCreateProject} />
        </div>
    );
}
