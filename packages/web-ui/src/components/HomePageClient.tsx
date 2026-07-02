
import { useCallback, useRef } from 'react';
import type { Project } from '@clash/web-ui/lib/types';
import HeroSection, { type HeroSectionHandle } from './HeroSection';
import RecentProjects from './RecentProjects';

interface HomePageClientProps {
    initialProjects: Project[];
}

export default function HomePageClient({ initialProjects }: HomePageClientProps) {
    const heroRef = useRef<HeroSectionHandle>(null);
    const handleStartNewProject = useCallback(() => {
        heroRef.current?.focus();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, []);

    return (
        <div className="text-slate-950 dark:text-slate-50">
            <HeroSection ref={heroRef} />
            <RecentProjects projects={initialProjects} onStartNewProject={handleStartNewProject} />
        </div>
    );
}
