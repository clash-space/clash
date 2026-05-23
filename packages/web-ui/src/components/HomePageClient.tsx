
import type { Project } from '@clash/web-ui/lib/types';
import HeroSection from './HeroSection';
import RecentProjects from './RecentProjects';

interface HomePageClientProps {
    initialProjects: Project[];
}

export default function HomePageClient({ initialProjects }: HomePageClientProps) {
    return (
        <div className="text-slate-950 dark:text-slate-50">
            <HeroSection />
            <RecentProjects projects={initialProjects} />
        </div>
    );
}
